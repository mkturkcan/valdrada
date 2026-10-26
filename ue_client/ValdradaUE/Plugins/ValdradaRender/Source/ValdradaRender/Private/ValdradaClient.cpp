#include "ValdradaClient.h"
#include "ValdradaLink.h"
#include "ValdradaFrames.h"
#include "ValdradaPathTraceExt.h"
#include "Camera/CameraActor.h"
#include "Camera/CameraComponent.h"
#include "Components/DirectionalLightComponent.h"
#include "Components/SkyAtmosphereComponent.h"
#include "Components/SkyLightComponent.h"
#include "Components/VolumetricCloudComponent.h"
#include "Engine/DirectionalLight.h"
#include "Engine/PostProcessVolume.h"
#include "Engine/SkyLight.h"
#include "Engine/ExponentialHeightFog.h"
#include "Components/ExponentialHeightFogComponent.h"
#include "Engine/World.h"
#include "GameFramework/PlayerController.h"
#include "Engine/GameViewportClient.h"
#include "Kismet/GameplayStatics.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Materials/MaterialParameterCollection.h"
#include "Materials/MaterialParameterCollectionInstance.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "HAL/IConsoleManager.h"
#include "Misc/FileHelper.h"
#include "Serialization/JsonSerializer.h"
#include "Serialization/JsonWriter.h"
#include "Misc/Paths.h"
#include "HAL/FileManager.h"
#include "Materials/Material.h"
#include "MaterialShared.h"
#if WITH_EDITOR
#include "ShaderCompiler.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogValdrada, Log, All);

namespace
{
	// world/sky.js PRESETS: the sun's elevation and azimuth (degrees), its key (sun x 3.4 sqrt(sin elevation)) and the
	// page's exposure per time of day as client/tools/ar34/export/phys_light.json fixes it for the takes
	struct FTimeOfDay { const TCHAR* Name; double Elev, Azim, SunK, Expo; };
	const FTimeOfDay TimesOfDay[] = {
		{ TEXT("day"), 42, 128, 2.5, 1.0 },
		{ TEXT("golden"), 15, 205, 4.0, 1.2414 },
		{ TEXT("dusk"), -3, 262, 1.0, 1.4 },
		{ TEXT("night"), -14, 280, 1.0, 1.5523 },
	};
	const FTimeOfDay& TimeOfDayOf(const FString& Name)
	{
		for (const FTimeOfDay& T : TimesOfDay) if (Name == T.Name) return T;
		return TimesOfDay[0];
	}
}

AValdradaClient::AValdradaClient()
{
	PrimaryActorTick.bCanEverTick = true;
	PrimaryActorTick.TickGroup = TG_PrePhysics;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
}

void AValdradaClient::BeginPlay()
{
	Super::BeginPlay();
	FString S;
	if (FParse::Value(FCommandLine::Get(), TEXT("ValdradaHost="), S)) Host = S;
	int32 P = 0;
	if (FParse::Value(FCommandLine::Get(), TEXT("ValdradaPort="), P)) Port = P;
	if (FParse::Value(FCommandLine::Get(), TEXT("ValdradaTier="), S)) Tier = S;
	if (FParse::Value(FCommandLine::Get(), TEXT("ValdradaTables="), S)) TablesDir = S;
	bNoView = FParse::Param(FCommandLine::Get(), TEXT("ValdradaNoView"));
	// the runtime of the path tracer's denoiser (NNEDenoiser): -ValdradaDenoiser=cpu|gpu|rdg. On Linux only ORT's CPU runtime
	// works (0.4-1.2 s a 2560x1440 frame by model and load): NNERuntimeRDGHlsl is not enabled for Vulkan, and with it enabled
	// (bSupportsNNEShaders) its images were wrong
	if (FParse::Value(FCommandLine::Get(), TEXT("ValdradaDenoiser="), S))
		if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(TEXT("NNEDenoiser.Runtime.Type")))
			V->Set(S == TEXT("rdg") ? TEXT("2") : S == TEXT("gpu") ? TEXT("1") : TEXT("0"), ECVF_SetByCode);
	if (FPaths::IsRelative(TablesDir)) TablesDir = FPaths::ConvertRelativePathToFull(FPaths::Combine(FPaths::ProjectDir(), TablesDir));
	LoadCity();
	// the streaming's per-frame budgets (ms, components), raised: a renderer that is loading draws nothing anyone reads, and
	// at a few frames a second the engine's defaults took minutes to add a 1 km block's thousands of components
	for (const TPair<const TCHAR*, const TCHAR*>& CV : TArray<TPair<const TCHAR*, const TCHAR*>>{
		{ TEXT("s.LevelStreamingActorsUpdateTimeLimit"), TEXT("50") }, { TEXT("s.PriorityLevelStreamingActorsUpdateExtraTime"), TEXT("50") },
		{ TEXT("s.UnregisterComponentsTimeLimit"), TEXT("20") }, { TEXT("s.AsyncLoadingTimeLimit"), TEXT("50") },
		{ TEXT("s.PriorityAsyncLoadingExtraTime"), TEXT("50") }, { TEXT("s.LevelStreamingComponentsRegistrationGranularity"), TEXT("500") },
		{ TEXT("s.LevelStreamingComponentsUnregistrationGranularity"), TEXT("100") },
		// (the path tracer's progress bar would be drawn into the captures)
		{ TEXT("r.PathTracing.ProgressDisplay"), TEXT("0") } })
		if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(CV.Key)) V->Set(CV.Value, ECVF_SetByCode);
	ApplyTier();
	SetupEnvironment();
	SemanticMat = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Client/Materials/M_client_semantic.M_client_semantic"));
	if (!SemanticMat) { UE_LOG(LogValdrada, Warning, TEXT("no /Game/Client/Materials/M_client_semantic (Tools/make_materials.py): no semantic output")); }
	else
	{
		// its shaders before the first capture: a post-process material without them falls back to the engine's
		// pass-through, and the capture would read the scene's colour as class ids
#if WITH_EDITOR
		SemanticMat->ForceRecompileForRendering();
		if (GShaderCompilingManager) GShaderCompilingManager->FinishAllCompilation();
#endif
		SemanticMat->EnsureIsComplete();
		const FMaterialResource* R = SemanticMat->GetMaterial()->GetMaterialResource(GMaxRHIShaderPlatform);
		const bool bReady = R && R->GetGameThreadShaderMap() != nullptr;
		Note(FString::Printf(TEXT("semantic material: shaders %s"), bReady ? TEXT("ready") : TEXT("MISSING (semantic output off)")));
		if (!bReady) bSemantic = false;
	}
	if (!bSemantic) SemanticMat = nullptr;
	ViewCam = GetWorld()->SpawnActor<ACameraActor>(ACameraActor::StaticClass(), FTransform(FRotator(-15, 0, 0), FVector(0, 0, 6000)));
	if (ViewCam) ViewCam->GetCameraComponent()->bConstrainAspectRatio = false;
	Link = MakeUnique<FValdradaLink>(Host, Port);
	Link->Start();
	ExitWatch = MakeUnique<FValdradaExitWatch>(Link.Get(), 3.f);
	PathTraceExt = FSceneViewExtensions::NewExtension<FValdradaPathTraceExt>();
	Note(FString::Printf(TEXT("renderer client: core %s:%d, tier %s, tables %s, city %s"), *Host, Port, *Tier, *TablesDir, City.bOk ? TEXT("loaded") : TEXT("MISSING")));
}

void AValdradaClient::ApplyTier()
{
	// Data/tiers.json: {"low": {"r.X": 1, ...}, "medium": ..., "high": ..., "cinematic": ...}, the render settings of the
	// persistent city's graphics tiers (tools/ue/persist_tiers.json without its own valdrada.* ranges and output size)
	FString Text;
	TSharedPtr<FJsonObject> J;
	if (!FFileHelper::LoadFileToString(Text, *FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/tiers.json"))) ||
		!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), J) || !J.IsValid())
	{
		Note(TEXT("tier: no Data/tiers.json, engine settings as configured"));
		return;
	}
	const TSharedPtr<FJsonObject>* T = nullptr;
	if (!J->TryGetObjectField(Tier.ToLower(), T) || !T || !T->IsValid())
	{
		Note(FString::Printf(TEXT("tier: '%s' is not in Data/tiers.json, engine settings as configured"), *Tier));
		return;
	}
	int32 N = 0, Missing = 0;
	for (const auto& KV : (*T)->Values)
	{
		const FString Key(KV.Key);
		if (Key.StartsWith(TEXT("_")) || Key == TEXT("res") || Key.StartsWith(TEXT("valdrada."))) continue;
		IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(*Key);
		if (!V) { ++Missing; continue; }
		double D = 0;
		FString S;
		if (KV.Value->TryGetNumber(D)) S = FString::SanitizeFloat(D, 0);
		else if (!KV.Value->TryGetString(S)) continue;
		if (S.EndsWith(TEXT(".0"))) S.LeftChopInline(2);
		V->Set(*S, ECVF_SetByCode);
		++N;
	}
	Note(FString::Printf(TEXT("tier %s: %d console variables set (%d unknown to this build)"), *Tier, N, Missing));
}

void AValdradaClient::Note(const FString& Line)
{
	UE_LOG(LogValdrada, Log, TEXT("%s"), *Line);
	static const FString Path = FPaths::Combine(FPaths::ProjectLogDir(), TEXT("ValdradaRender.log"));
	FFileHelper::SaveStringToFile(FDateTime::Now().ToString(TEXT("%Y-%m-%d %H:%M:%S ")) + Line + LINE_TERMINATOR, *Path,
		FFileHelper::EEncodingOptions::ForceUTF8WithoutBOM, &IFileManager::Get(), FILEWRITE_Append);
}

void AValdradaClient::EndPlay(const EEndPlayReason::Type Reason)
{
	// the captures still waiting get an error, so the core's tick returns at once
	for (const FCaptureJob& J : Captures) Fail(J, TEXT("renderer_exiting"), TEXT("the renderer is shutting down"));
	Captures.Reset();
	ExitWatch.Reset();
	if (Link) { Link->Shutdown(); Link.Reset(); }
	Note(FString::Printf(TEXT("stopping (%s)"), Reason == EEndPlayReason::Quit ? TEXT("quit") : TEXT("end of play")));
	Super::EndPlay(Reason);
	if (Reason == EEndPlayReason::Quit && bFastExit)
	{
		if (GLog) GLog->Flush();
		FPlatformMisc::RequestExitWithStatus(true, 0);
	}
}

int32 AValdradaClient::SendRequest(const FString& Method, const TSharedRef<FJsonObject>& Params, const TArray<TArrayView<const uint8>>& Blobs)
{
	if (!Link) return 0;
	TSharedRef<FJsonObject> M = MakeShared<FJsonObject>();
	const int32 Id = NextId++;
	M->SetNumberField(TEXT("id"), Id);
	M->SetStringField(TEXT("method"), Method);
	M->SetObjectField(TEXT("params"), Params);
	Link->Send(M, Blobs);
	return Id;
}

void AValdradaClient::SendHello()
{
	TSharedRef<FJsonObject> P = MakeShared<FJsonObject>();
	P->SetStringField(TEXT("protocol"), TEXT("valdrada.render/0"));
	P->SetStringField(TEXT("renderer"), TEXT("unreal"));
	P->SetStringField(TEXT("version"), FString::Printf(TEXT("ValdradaRender 0.1, Unreal Engine %d.%d"), ENGINE_MAJOR_VERSION, ENGINE_MINOR_VERSION));
	TArray<TSharedPtr<FJsonValue>> Outs;
	for (const TCHAR* O : { TEXT("rgb"), TEXT("depth") }) Outs.Add(MakeShared<FJsonValueString>(O));
	if (SemanticMat) Outs.Add(MakeShared<FJsonValueString>(TEXT("semantic")));
	P->SetArrayField(TEXT("outputs"), Outs);
	TArray<TSharedPtr<FJsonValue>> Max = { MakeShared<FJsonValueNumber>(3840), MakeShared<FJsonValueNumber>(2160) };
	P->SetArrayField(TEXT("max_size"), Max);
	P->SetStringField(TEXT("tier"), Tier);
	P->SetBoolField(TEXT("amodal"), false);
	SendRequest(TEXT("render.hello"), P);
	bHelloSent = true;
	// a new session: what the last one loaded stays; the hello's load set decides what goes
	LoadFrame = -1; LastPending = -1;
}

void AValdradaClient::Tick(float DeltaSeconds)
{
	Super::Tick(DeltaSeconds);
	if (ViewCam)
		if (APlayerController* PC = GetWorld()->GetFirstPlayerController())
			if (PC->GetViewTarget() != ViewCam) PC->SetViewTarget(ViewCam);
	if (bNoView)
		if (UGameViewportClient* GV = GetWorld()->GetGameViewport()) GV->bDisableWorldRendering = true;
	if (Link && Link->TakeConnectedEdge()) SendHello();
	FValdradaMessage M;
	int32 N = 0;
	while (Link && Link->Poll(M))
	{
		Dispatch(M);
		// a capture waits for the frames it renders: the messages after it are read once it is answered
		if (++N > 4096 || Captures.Num() > 0) break;
	}
	StepStreaming();
	StepCaptures();
	ReportLoaded(false);
}

void AValdradaClient::Dispatch(FValdradaMessage& M)
{
	const TSharedPtr<FJsonObject>& J = M.Json;
	FString Ev;
	if (J->TryGetStringField(TEXT("event"), Ev))
	{
		if (Ev == TEXT("render.state")) OnState(M);
		else if (Ev == TEXT("render.load")) OnLoad(J);
		else if (Ev == TEXT("render.capture")) OnCapture(J);
		return;
	}
	const TSharedPtr<FJsonObject>* Err = nullptr;
	if (J->TryGetObjectField(TEXT("error"), Err))
	{
		UE_LOG(LogValdrada, Warning, TEXT("core error: %s: %s"), *(*Err)->GetStringField(TEXT("code")), *(*Err)->GetStringField(TEXT("message")));
		return;
	}
	const TSharedPtr<FJsonObject>* Res = nullptr;
	if (J->TryGetObjectField(TEXT("result"), Res) && (*Res)->HasField(TEXT("protocol")))
	{
		// the hello's answer
		const TSharedPtr<FJsonObject>& R = *Res;
		const TArray<TSharedPtr<FJsonValue>>* Kinds = nullptr;
		if (R->TryGetArrayField(TEXT("vehicle_kinds"), Kinds)) SetupKinds(*Kinds);
		const TSharedPtr<FJsonObject>* O = nullptr;
		if (R->TryGetObjectField(TEXT("env"), O)) ApplyEnv(*O);
		if (R->TryGetObjectField(TEXT("view"), O)) ApplyView(*O);
		if (R->TryGetObjectField(TEXT("load"), O)) OnLoad(*O);
		Note(FString::Printf(TEXT("attached to the core: %s, API %s, %d vehicle kinds"), *R->GetStringField(TEXT("protocol")), *R->GetStringField(TEXT("api_version")), KindNames.Num()));
	}
}

// ---------------------------------------------------------------- environment
void AValdradaClient::SetupEnvironment()
{
	UWorld* W = GetWorld();
	FActorSpawnParameters SP;
	SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
	Sun = W->SpawnActor<ADirectionalLight>(ADirectionalLight::StaticClass(), FTransform(FVector(0, 0, 1000000)), SP);
	if (Sun)
	{
		UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent());
		L->SetMobility(EComponentMobility::Movable);
		L->SetAtmosphereSunLight(true);
		L->SetCastShadows(true);
		L->LightSourceAngle = 0.53f;
		L->bCastCloudShadows = true;
		L->CloudShadowStrength = 0.8f;
		L->CloudShadowOnSurfaceStrength = 1.0f;
		L->bCastShadowsOnClouds = true;
		L->MarkRenderStateDirty();
	}
	Moon = W->SpawnActor<ADirectionalLight>(ADirectionalLight::StaticClass(), FTransform(FVector(0, 0, 1000000)), SP);
	if (Moon)
	{
		// after dark (ue_light.py): a low moon lights the clouds, no shadow of its own
		UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Moon->GetLightComponent());
		L->SetMobility(EComponentMobility::Movable);
		L->SetAtmosphereSunLight(true);
		L->ForwardShadingPriority = 0;
		L->SetAtmosphereSunLightIndex(1);
		L->SetCastShadows(false);
		L->SetIntensity(0.04f);
		L->SetLightColor(FLinearColor(FColor(200, 215, 255)));
		Moon->SetActorRotation(Valdrada::Dir(-0.35, -0.6, 0.72).Rotation());
		L->SetVisibility(false);
	}
	Atmosphere = W->SpawnActor<ASkyAtmosphere>(ASkyAtmosphere::StaticClass(), FTransform::Identity, SP);
	if (Atmosphere) Atmosphere->GetComponent()->SetAerialPespectiveViewDistanceScale(0.25f);
	Clouds = W->SpawnActor<AVolumetricCloud>(AVolumetricCloud::StaticClass(), FTransform::Identity, SP);
	if (Clouds)
		if (UMaterialInterface* CM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Engine/EngineSky/VolumetricClouds/m_SimpleVolumetricCloud_Inst.m_SimpleVolumetricCloud_Inst")))
			if (UVolumetricCloudComponent* VC = Clouds->FindComponentByClass<UVolumetricCloudComponent>()) VC->SetMaterial(CM);
	SkyLight = W->SpawnActor<ASkyLight>(ASkyLight::StaticClass(), FTransform::Identity, SP);
	if (SkyLight)
	{
		USkyLightComponent* S = SkyLight->GetLightComponent();
		S->SetMobility(EComponentMobility::Movable);
		S->SourceType = SLS_CapturedScene;
		S->SetRealTimeCapture(true);
		S->bLowerHemisphereIsBlack = false;
		S->SetIntensity(1.0f);
		S->MarkRenderStateDirty();
	}
	// the film look (ue_light.py setup_film): manual exposure, UE's tonemapper replaced by M_bx_film (the page's AgX at its
	// exposure), Lumen's GI and reflections with hit lighting, no motion blur, grain, vignette or flares
	Film = W->SpawnActor<APostProcessVolume>(APostProcessVolume::StaticClass(), FTransform::Identity, SP);
	if (Film)
	{
		Film->bUnbound = true;
		FPostProcessSettings& PS = Film->Settings;
		PS.bOverride_AutoExposureMethod = true; PS.AutoExposureMethod = AEM_Manual;
		PS.bOverride_AutoExposureBias = true; PS.AutoExposureBias = 0.f;
		PS.bOverride_AutoExposureApplyPhysicalCameraExposure = true; PS.AutoExposureApplyPhysicalCameraExposure = 0;
		PS.bOverride_MotionBlurAmount = true; PS.MotionBlurAmount = 0.f;
		PS.bOverride_FilmGrainIntensity = true; PS.FilmGrainIntensity = 0.f;
		PS.bOverride_SceneFringeIntensity = true; PS.SceneFringeIntensity = 0.f;
		PS.bOverride_VignetteIntensity = true; PS.VignetteIntensity = 0.f;
		PS.bOverride_LensFlareIntensity = true; PS.LensFlareIntensity = 0.f;
		PS.bOverride_LocalExposureHighlightContrastScale = true; PS.LocalExposureHighlightContrastScale = 1.f;
		PS.bOverride_LocalExposureShadowContrastScale = true; PS.LocalExposureShadowContrastScale = 1.f;
		PS.bOverride_LumenFinalGatherQuality = true; PS.LumenFinalGatherQuality = 2.f;
		PS.bOverride_LumenSceneDetail = true; PS.LumenSceneDetail = 2.f;
		PS.bOverride_LumenSceneLightingQuality = true; PS.LumenSceneLightingQuality = 2.f;
		PS.bOverride_LumenReflectionQuality = true; PS.LumenReflectionQuality = 2.f;
		PS.bOverride_LumenMaxTraceDistance = true; PS.LumenMaxTraceDistance = 20000.f;
		PS.bOverride_ReflectionMethod = true; PS.ReflectionMethod = EReflectionMethod::Lumen;
		// (Lumen's reflections from its surface cache: hit lighting, as the takes use it, hung the GPU in LumenReflections on
		// the first night frame here, the device lost)
		if (UMaterialInterface* FM = LoadObject<UMaterialInterface>(nullptr, TEXT("/Game/Bx/M_bx_film.M_bx_film")))
		{
			FilmMID = UMaterialInstanceDynamic::Create(FM, this);
			for (const TPair<const TCHAR*, float>& KV : TArray<TPair<const TCHAR*, float>>{ { TEXT("Sat"), 1.f }, { TEXT("Con"), 0.f }, { TEXT("Blk"), 0.f }, { TEXT("Wht"), 1.f },
				{ TEXT("Hi"), 0.f }, { TEXT("Warm"), 0.f }, { TEXT("TintG"), 0.f }, { TEXT("Vig"), 0.f }, { TEXT("Grain"), 0.f }, { TEXT("Expo"), 1.f } })
				FilmMID->SetScalarParameterValue(KV.Key, KV.Value);
			PS.WeightedBlendables.Array.Add(FWeightedBlendable(1.f, FilmMID));
		}
		else UE_LOG(LogValdrada, Warning, TEXT("no /Game/Bx/M_bx_film: Unreal's own tonemapper"));
	}
	NightMPC = LoadObject<UMaterialParameterCollection>(nullptr, TEXT("/Game/Bx/MPC_r1c.MPC_r1c"));
	TSharedRef<FJsonObject> Env = MakeShared<FJsonObject>();
	Env->SetStringField(TEXT("time_of_day"), TEXT("day"));
	Env->SetNumberField(TEXT("night"), 0);
	ApplyEnv(Env);
}

void AValdradaClient::ApplyEnv(const TSharedPtr<FJsonObject>& Env)
{
	if (!Env.IsValid()) return;
	FString Tod = TimeOfDay;
	Env->TryGetStringField(TEXT("time_of_day"), Tod);
	double Night = NightValue;
	Env->TryGetNumberField(TEXT("night"), Night);
	if (Tod != TimeOfDay)
	{
		TimeOfDay = Tod;
		const FTimeOfDay& T = TimeOfDayOf(Tod);
		const double El = FMath::DegreesToRadians(T.Elev), Az = FMath::DegreesToRadians(T.Azim);
		// world/sky.js: the direction to the sun in the page's frame; the light travels the other way
		const FVector ToSun(FMath::Cos(El) * FMath::Sin(Az), FMath::Sin(El), -FMath::Cos(El) * FMath::Cos(Az));
		const bool bUp = T.Elev > -1.0;
		if (Sun)
		{
			Sun->SetActorRotation(Valdrada::Dir(-ToSun.X, -ToSun.Y, -ToSun.Z).Rotation());
			UDirectionalLightComponent* L = Cast<UDirectionalLightComponent>(Sun->GetLightComponent());
			L->SetIntensity(float(3.4 * FMath::Sqrt(FMath::Max(FMath::Sin(El), 0.0)) * T.SunK));
			// the atmosphere colours the low sun itself (ue_light.py keeps half the page's warmth over it)
			L->SetLightColor(Tod == TEXT("golden") ? FLinearColor(1.0f, 0.86f, 0.70f) : FLinearColor(1.0f, 0.97f, 0.93f));
			L->SetVisibility(bUp);
		}
		if (Moon) Moon->GetLightComponent()->SetVisibility(!bUp);
		PresetExpo = float(T.Expo);
		if (FilmMID) FilmMID->SetScalarParameterValue(TEXT("Expo"), PresetExpo);
		if (SkyLight) SkyLight->GetLightComponent()->RecaptureSky();
		UE_LOG(LogValdrada, Log, TEXT("time of day %s: sun %.0f / %.0f deg"), *Tod, T.Elev, T.Azim);
	}
	if (FMath::Abs(Night - double(NightValue)) > 1e-4)   // (a float against the message's double: equal values compared unequal every state)
	{
		NightValue = float(Night);
		// the night factor of world/sky.js: lit windows, lamps and headlamps in the city's materials (MPC_r1c.Night, as the
		// takes key it in r1c_actors.py)
		if (NightMPC)
			if (UMaterialParameterCollectionInstance* I = GetWorld()->GetParameterCollectionInstance(NightMPC))
				I->SetScalarParameterValue(TEXT("Night"), NightValue);
	}
	ApplyEnvLook(Env, Tod != LastLookTod);
	LastLookTod = Tod;
}


void AValdradaClient::ApplyView(const TSharedPtr<FJsonObject>& View)
{
	double P[3], Q[4], Fov = 58.7, Aspect = 16.0 / 9.0;
	if (!ViewCam || !Valdrada::Num3(View, TEXT("pos"), P, 3) || !Valdrada::Num3(View, TEXT("quat"), Q, 4)) return;
	View->TryGetNumberField(TEXT("fov_y_deg"), Fov);
	View->TryGetNumberField(TEXT("aspect"), Aspect);
	ViewCam->SetActorLocationAndRotation(Valdrada::Pos(P[0], P[1], P[2]), Valdrada::CameraRotation(Q[0], Q[1], Q[2], Q[3]));
	ViewCam->GetCameraComponent()->SetFieldOfView(Valdrada::HFov(Fov, Aspect));
}

// A take's own light where the env names it (a replay of a recorded take: tools/core/replay.mjs reads the take's
// harvest): `sun` {dir (toward the sun, the core's frame), intensity, color (linear)}, `film` (M_bx_film's parameters:
// Expo and the grade), `aerial` {scale, start_km}. Applied over the time of day's preset, once each until they change.
void AValdradaClient::ApplyEnvLook(const TSharedPtr<FJsonObject>& Env, bool bForce)
{
	// (once until it changes, or the time of day's preset was set again under it)
	FString Key;
	bool bRT = true;
	if (Env->TryGetBoolField(TEXT("skylight_realtime"), bRT)) Key += bRT ? TEXT("rt1") : TEXT("rt0");
	for (const TCHAR* F : { TEXT("sun"), TEXT("film"), TEXT("aerial"), TEXT("fog"), TEXT("atmosphere") })
	{
		const TSharedPtr<FJsonObject>* X = nullptr;
		if (!Env->TryGetObjectField(F, X)) continue;
		FString T;
		FJsonSerializer::Serialize(X->ToSharedRef(), TJsonWriterFactory<TCHAR, TCondensedJsonPrintPolicy<TCHAR>>::Create(&T));
		Key += T;
	}
	if (Key.IsEmpty() || (Key == LastLook && !bForce)) return;
	LastLook = Key;
	const TSharedPtr<FJsonObject>* O = nullptr;
	if (Env->TryGetObjectField(TEXT("sun"), O) && Sun)
	{
		double D[3], C[3] = { 1, 1, 1 }, I = 0;
		if (Valdrada::Num3(*O, TEXT("dir"), D, 3))
		{
			Sun->SetActorRotation(Valdrada::Dir(-D[0], -D[1], -D[2]).Rotation());
			if (Moon) Moon->GetLightComponent()->SetVisibility(D[1] < -0.02);
			Sun->GetLightComponent()->SetVisibility(D[1] > -0.02);
		}
		if ((*O)->TryGetNumberField(TEXT("intensity"), I)) Sun->GetLightComponent()->SetIntensity(float(I));
		if (Valdrada::Num3(*O, TEXT("color"), C, 3)) Sun->GetLightComponent()->SetLightColor(FLinearColor(float(C[0]), float(C[1]), float(C[2])));
	}
	if (Env->TryGetObjectField(TEXT("film"), O) && FilmMID)
	{
		for (const auto& KV : (*O)->Values)
		{
			const FName P(*FString(*KV.Key));
			const float V = float(KV.Value->AsNumber());
			FilmMID->SetScalarParameterValue(P, V);
			for (auto& C : Cams) if (C.Value.Film) C.Value.Film->SetScalarParameterValue(P, V);
			if (P == FName(TEXT("Expo"))) PresetExpo = V;
		}
		for (auto& C : Cams) C.Value.LastExpo = -1.f;
	}
	if (Env->TryGetObjectField(TEXT("fog"), O))
	{
		// an exponential height fog at street level, as ue_light.py's cinematic preset sets it (density, falloff, cap,
		// cutoff m, inscattering, the volumetric part within vol_distance m)
		if (!Fog)
		{
			FActorSpawnParameters SP;
			SP.SpawnCollisionHandlingOverride = ESpawnActorCollisionHandlingMethod::AlwaysSpawn;
			Fog = GetWorld()->SpawnActor<AExponentialHeightFog>(AExponentialHeightFog::StaticClass(), FTransform::Identity, SP);
		}
		if (UExponentialHeightFogComponent* F = Fog ? Fog->GetComponent() : nullptr)
		{
			double V = 0, C[3];
			if ((*O)->TryGetNumberField(TEXT("density"), V)) F->FogDensity = float(V);
			if ((*O)->TryGetNumberField(TEXT("falloff"), V)) F->FogHeightFalloff = float(V);
			if ((*O)->TryGetNumberField(TEXT("max_opacity"), V)) F->FogMaxOpacity = float(V);
			if ((*O)->TryGetNumberField(TEXT("cutoff_m"), V)) F->FogCutoffDistance = float(V * 100.0);
			if (Valdrada::Num3(*O, TEXT("inscatter"), C, 3)) F->FogInscatteringLuminance = FLinearColor(float(C[0]), float(C[1]), float(C[2]));
			bool B = false;
			if ((*O)->TryGetBoolField(TEXT("volumetric"), B)) F->bEnableVolumetricFog = B;
			if ((*O)->TryGetNumberField(TEXT("vol_distance_m"), V)) F->VolumetricFogDistance = float(V * 100.0);
			F->StartDistance = 0.f;
			F->VolumetricFogStartDistance = 0.f;
			F->VolumetricFogScatteringDistribution = 0.6f;
			F->VolumetricFogAlbedo = FColor(235, 235, 235);
			F->VolumetricFogExtinctionScale = 1.f;
			F->MarkRenderStateDirty();
		}
	}
	bool bRealTime = true;
	if (Env->TryGetBoolField(TEXT("skylight_realtime"), bRealTime) && SkyLight)
	{
		// (the path tracer restarts its accumulation whenever the sky light's capture changes: a real-time capture is
		// taken once and kept for a path-traced replay)
		USkyLightComponent* SL = SkyLight->GetLightComponent();
		SL->SetRealTimeCapture(bRealTime);
		SL->RecaptureSky();
	}
	if (Env->TryGetObjectField(TEXT("aerial"), O) && Atmosphere)
	{
		double V = 0;
		if ((*O)->TryGetNumberField(TEXT("scale"), V)) Atmosphere->GetComponent()->SetAerialPespectiveViewDistanceScale(float(V));
		if ((*O)->TryGetNumberField(TEXT("start_km"), V)) Atmosphere->GetComponent()->SetAerialPerspectiveStartDepth(float(V));
	}
	if (Env->TryGetObjectField(TEXT("atmosphere"), O) && Atmosphere)
	{
		// the sky atmosphere's scattering against the engine's defaults (scales), its planet's ground albedo (linear) and
		// the raster's multiple-scattering factor: the path tracer's reference atmosphere takes them as its medium
		USkyAtmosphereComponent* A = Atmosphere->GetComponent();
		const USkyAtmosphereComponent* D = GetDefault<USkyAtmosphereComponent>();
		double V = 0, C[3];
		if ((*O)->TryGetNumberField(TEXT("rayleigh"), V)) A->SetRayleighScatteringScale(float(D->RayleighScatteringScale * V));
		if ((*O)->TryGetNumberField(TEXT("mie"), V)) A->SetMieScatteringScale(float(D->MieScatteringScale * V));
		if ((*O)->TryGetNumberField(TEXT("mie_absorption"), V)) A->SetMieAbsorptionScale(float(D->MieAbsorptionScale * V));
		if ((*O)->TryGetNumberField(TEXT("mie_g"), V)) A->SetMieAnisotropy(float(V));
		if ((*O)->TryGetNumberField(TEXT("multi_scattering"), V)) A->SetMultiScatteringFactor(float(V));
		if (Valdrada::Num3(*O, TEXT("ground_albedo"), C, 3)) A->SetGroundAlbedo(FLinearColor(float(C[0]), float(C[1]), float(C[2])).ToFColor(true));
	}
}
