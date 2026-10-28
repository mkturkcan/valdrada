#include "ValdradaWorld.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/CollisionProfile.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/World.h"
#include "Engine/Engine.h"
#include "Engine/Level.h"
#include "Engine/LevelStreaming.h"
#include "EngineUtils.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#include "GameFramework/PlayerController.h"
#include "Camera/PlayerCameraManager.h"
#include "UObject/UObjectIterator.h"
#include "HAL/IConsoleManager.h"
#include "HAL/PlatformTime.h"
#include "LevelInstance/LevelInstanceInterface.h"
#include "Engine/LevelStreamingDynamic.h"
#include "Materials/MaterialInterface.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Modules/ModuleManager.h"
#include "WorldPartition/WorldPartition.h"
#include "WorldPartition/WorldPartitionRuntimeHash.h"
#include "WorldPartition/WorldPartitionRuntimeSpatialHash.h"
#include "UObject/UnrealType.h"
#include "HAL/FileManager.h"
#include "MoviePipelineQueueEngineSubsystem.h"
#include "MoviePipelineQueue.h"
#include "MoviePipelineBlueprintLibrary.h"
#include "MoviePipelinePrimaryConfig.h"
#include "MoviePipelineOutputSetting.h"
#include "LevelSequence.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, ValdradaWorld);
DEFINE_LOG_CATEGORY_STATIC(LogValdradaWorld, Log, All);

static TAutoConsoleVariable<int32> CVarSwap(TEXT("valdrada.Swap"), 1, TEXT("hide far stand-ins (vf+key) while their near actor (vn+key) is loaded and visible"));
static TAutoConsoleVariable<int32> CVarBlock(TEXT("valdrada.BlockStreaming"), 0, TEXT("1: finish pending level streaming in the tick it is requested (offline renders: no frame with a block missing)"));
static TAutoConsoleVariable<FString> CVarServer(TEXT("valdrada.ShotServerDir"), TEXT(""), TEXT("a folder of shot requests (<name>.req) this game process renders in its loaded level"));
static TAutoConsoleVariable<float> CVarDumpAfter(TEXT("valdrada.DumpAfter"), 0.f, TEXT("seconds after the level starts: run valdrada.DumpCmds once (memory reports)"));
static TAutoConsoleVariable<FString> CVarDumpCmds(TEXT("valdrada.DumpCmds"), TEXT("rhi.DumpResourceMemory summary;rhi.DumpResourceMemory all;r.Vulkan.DumpMemory"), TEXT("console commands, ; separated"));
static TAutoConsoleVariable<int32> CVarKit(TEXT("valdrada.Kit"), 1, TEXT("0: the kit cells build nothing (memory attribution)"));
static TAutoConsoleVariable<int32> CVarFarRT(TEXT("valdrada.FarInstancesInRayTracing"), 0, TEXT("0: the far stand-ins' instanced meshes (trees, kit) stay out of the ray tracing scene (over 16 M instances overflowed it: zero-sized FRayTracingScene::SceneBuffer)"));
static TAutoConsoleVariable<float> CVarBlocksM(TEXT("valdrada.BlocksRangeM"), 0.f, TEXT("per-render loading range of the grid Blocks in metres (0: the level's), through wp.Runtime.OverrideRuntimeLoadingRange once the level is up (a job cvar)"));
static TAutoConsoleVariable<float> CVarDefBlocksM(TEXT("valdrada.DefaultBlocksRangeM"), 4000.f, TEXT("metres: the near blocks' range when valdrada.BlocksRangeM is 0 (no tier); 0: every block World Partition loads (its coarse hash cells reached ~11 km, beyond the far city's hand-over)"));
static TAutoConsoleVariable<float> CVarBlockKitM(TEXT("valdrada.BlockKitRangeM"), 0.f, TEXT("metres: a near block builds its own reduced kit only within this distance (0: all of it, no cracks; the capped tiers set their reduced-kit range: the whole blocks' kit did not fit 8/12/16 GB)"));
static TAutoConsoleVariable<float> CVarRTRangeM(TEXT("valdrada.RTRangeM"), 0.f, TEXT("metres: blocks farther than this from the lens leave the ray tracing scene (their geometry is evicted); 0 keeps all"));
static TAutoConsoleVariable<int32> CVarLevelCollision(TEXT("valdrada.LevelCollision"), 0, TEXT("0: the streamed levels' components lose collision before they register (renders: a cooked city made a physics body per instance and spent minutes adding and removing them)"));
static TAutoConsoleVariable<float> CVarKitFarM(TEXT("valdrada.KitFarRangeM"), 0.f, TEXT("per-render loading range of the grid KitFar (reduced kit) in metres (0: the level's)"));
static TAutoConsoleVariable<float> CVarKitM(TEXT("valdrada.KitRangeM"), 0.f, TEXT("per-render loading range of the grid Kit (full kit tables) in metres (0: the level's)"));
static TAutoConsoleVariable<float> CVarFarM(TEXT("valdrada.FarRangeM"), 0.f, TEXT("per-render loading range of the grid Far (the far city) in metres (0: the level's)"));
static TAutoConsoleVariable<int32> CVarInstDF(TEXT("valdrada.InstanceDistanceField"), 0, TEXT("0: the kit's and the streamed levels' instanced meshes stay out of the mesh distance fields (their per-instance distance field objects and uploads were 2.5 GB of the low tier's 8 GB; Lumen's software tracing keeps the buildings, every other tier traces in hardware)"));
static TAutoConsoleVariable<int32> CVarTier(TEXT("valdrada.Tier"), -1, TEXT("graphics tier: 0 low (8 GB), 1 medium (12 GB), 2 high (16 GB), 3 cinematic; applies the tier's console variables from valdrada.TierFile"));
static TAutoConsoleVariable<FString> CVarTierFile(TEXT("valdrada.TierFile"), TEXT("/data0/projectnyc_aux/v2_wt/city-v2/tools/ue/persist_tiers.json"), TEXT("the tiers' table (tools/ue/persist_tiers.json)"));
static TAutoConsoleVariable<float> CVarLog(TEXT("valdrada.SwapLogSeconds"), 10.f, TEXT("seconds between swap counts in the log (0 off)"));

// (the near blocks' range in metres: the tier's, else the default; 0 none)
static float NearBlocksM() { const float M = CVarBlocksM.GetValueOnGameThread(); return M > 0.f ? M : CVarDefBlocksM.GetValueOnGameThread(); }

// ---- the kit cell (the table format: tools/ue/vcel_write.py; the reader as ValdradaCells' AValdradaCell)
namespace
{
	struct FReader
	{
		const TArray<uint8>& B; int64 O = 0; bool bBad = false;
		explicit FReader(const TArray<uint8>& In) : B(In) {}
		bool Need(int64 N) { if (O + N > B.Num()) { bBad = true; } return !bBad; }
		uint32 U32() { if (!Need(4)) return 0; uint32 V; FMemory::Memcpy(&V, B.GetData() + O, 4); O += 4; return V; }
		uint16 U16() { if (!Need(2)) return 0; uint16 V; FMemory::Memcpy(&V, B.GetData() + O, 2); O += 2; return V; }
		FString Str()
		{
			const uint16 N = U16();
			if (!Need(N)) return FString();
			FUTF8ToTCHAR Conv(reinterpret_cast<const ANSICHAR*>(B.GetData() + O), N); O += N;
			return FString(Conv.Length(), Conv.Get());
		}
		const float* Floats(int64 N) { if (!Need(N * 4)) return nullptr; const float* P = reinterpret_cast<const float*>(B.GetData() + O); O += N * 4; return P; }
	};
}

AValdradaStreamCell::AValdradaStreamCell()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Static);
}

#if WITH_EDITOR
void AValdradaStreamCell::GetStreamingBounds(FBox& OutRuntimeBounds, FBox& OutEditorBounds) const
{
	Super::GetStreamingBounds(OutRuntimeBounds, OutEditorBounds);
	if (StreamBounds.IsValid) { OutRuntimeBounds = StreamBounds; OutEditorBounds = StreamBounds; }
}
#endif

void AValdradaStreamCell::BeginPlay()
{
	Super::BeginPlay();
	// (far kit: built by the swap when wanted; near kit too when valdrada.KitRangeM is set: the swap builds it by distance)
	if (Made.Num() == 0 && !(Tags.Num() >= 1 && Tags[0] == FName(TEXT("vf"))) && CVarKitM.GetValueOnGameThread() <= 0.f) Build();
}

void AValdradaStreamCell::Clear()
{
	for (UInstancedStaticMeshComponent* C : Made) if (C) C->DestroyComponent();
	Made.Reset(); BuiltInstances = 0; bBuilt = false;
}

int32 AValdradaStreamCell::Build()
{
	Clear();
	bBuilt = true;
	if (!CVarKit.GetValueOnGameThread()) return 0;
	struct FAcc { FString Mesh; TArray<FString> Mats; uint32 Flags = 0, NCustom = 0; TArray<FTransform> Xf; TArray<float> Cd; };
	TMap<FString, FAcc> Acc;
	TArray<FString> Paths = TablePaths;
	if (!TablePath.IsEmpty()) Paths.Add(TablePath);
	const FVector O = GetActorLocation();   // (the tables are in world space; the actor sits at its bounds' centre)
	for (FString Path : Paths)
	{
		if (FPaths::IsRelative(Path)) Path = FPaths::Combine(FPaths::ProjectDir(), Path);
		TArray<uint8> Bytes;
		if (!FFileHelper::LoadFileToArray(Bytes, *Path)) { UE_LOG(LogValdradaWorld, Warning, TEXT("%s: no table at %s"), *GetName(), *Path); continue; }
		FReader R(Bytes);
		const uint32 Magic = R.U32(), Version = R.U32(), Sets = R.U32();
		if (Magic != 0x4C454356u || Version != 1) { UE_LOG(LogValdradaWorld, Warning, TEXT("%s: not a version 1 table: %s"), *GetName(), *Path); continue; }
		for (uint32 S = 0; S < Sets && !R.bBad; ++S)
		{
			const FString MeshPath = R.Str();
			const uint16 NMat = R.U16();
			TArray<FString> MatPaths; for (uint16 M = 0; M < NMat; ++M) MatPaths.Add(R.Str());
			const uint32 Flags = R.U32(), NCustom = R.U32(), N = R.U32();
			const float* X = R.Floats(int64(N) * 12);
			const float* Cd = R.Floats(int64(N) * NCustom);
			if (R.bBad) break;
			const FString Key = MeshPath + TEXT("|") + FString::Join(MatPaths, TEXT("|")) + FString::Printf(TEXT("|%u|%u"), Flags, NCustom);
			FAcc& A = Acc.FindOrAdd(Key);
			if (A.Mesh.IsEmpty()) { A.Mesh = MeshPath; A.Mats = MatPaths; A.Flags = Flags; A.NCustom = NCustom; }
			for (uint32 I = 0; I < N; ++I)
			{
				const float* V = X + int64(I) * 12;
				const FMatrix M(FPlane(V[0], V[1], V[2], 0.f), FPlane(V[3], V[4], V[5], 0.f), FPlane(V[6], V[7], V[8], 0.f), FPlane(V[9] - O.X, V[10] - O.Y, V[11] - O.Z, 1.f));
				A.Xf.Emplace(M);
			}
			if (NCustom > 0) A.Cd.Append(Cd, int32(N * NCustom));
		}
	}
	for (auto& KV : Acc)
	{
		FAcc& A = KV.Value;
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *A.Mesh);
		if (!Mesh) { UE_LOG(LogValdradaWorld, Warning, TEXT("%s: no mesh %s"), *GetName(), *A.Mesh); continue; }
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this, NAME_None, RF_Transient);
		C->SetMobility(EComponentMobility::Static);
		C->SetStaticMesh(Mesh);
		for (int32 M = 0; M < A.Mats.Num(); ++M)
			if (!A.Mats[M].IsEmpty())
				if (UMaterialInterface* Mi = LoadObject<UMaterialInterface>(nullptr, *A.Mats[M])) C->SetMaterial(M, Mi);
		C->SetCastShadow((A.Flags & 1u) != 0);
		C->bVisibleInRayTracing = bRayTracing;
		// (no physics for render instances: with collision every kit instance was a Chaos body, and the game thread spent
		// minutes in the physics scene's spatial queue (FPendingSpatialDataQueue::Remove) before the first frame)
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->bAffectDistanceFieldLighting = CVarInstDF.GetValueOnGameThread() != 0;
		C->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		C->SetCanEverAffectNavigation(false);
		C->SetGenerateOverlapEvents(false);
		C->SetupAttachment(RootComponent);
		C->NumCustomDataFloats = int32(A.NCustom);
		C->AddInstances(A.Xf, false, false, false);
		if (A.NCustom > 0 && A.Cd.Num() == A.Xf.Num() * int32(A.NCustom))
		{
			C->PerInstanceSMCustomData.SetNumUninitialized(A.Cd.Num());
			FMemory::Memcpy(C->PerInstanceSMCustomData.GetData(), A.Cd.GetData(), sizeof(float) * A.Cd.Num());
		}
		C->SetHiddenInGame(IsHidden());
		C->RegisterComponent();
		AddInstanceComponent(C);
		Made.Add(C);
		BuiltInstances += A.Xf.Num();
	}
	return BuiltInstances;
}

// ---- the level streamer
AValdradaLevelStreamer::AValdradaLevelStreamer()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Static);
}

#if WITH_EDITOR
void AValdradaLevelStreamer::GetStreamingBounds(FBox& OutRuntimeBounds, FBox& OutEditorBounds) const
{
	Super::GetStreamingBounds(OutRuntimeBounds, OutEditorBounds);
	if (StreamBounds.IsValid) { OutRuntimeBounds = StreamBounds; OutEditorBounds = StreamBounds; }
}
#endif

void AValdradaLevelStreamer::BeginPlay()
{
	Super::BeginPlay();
	// (a far stand-in loads only when the swap wants it: loaded at once and dropped a tick later under a loaded block,
	// thousands of levels' physics bodies were added and removed, minutes in Chaos's pending spatial queue)
	if (Tags.Num() >= 1 && Tags[0] == FName(TEXT("vf"))) return;
	if (NearBlocksM() > 0.f) return;   // (the swap loads the block by distance, valdrada.BlocksRangeM / DefaultBlocksRangeM)
	if (Level.IsNull() || Streaming) return;
	StartStreaming();
}

void AValdradaLevelStreamer::StartStreaming()
{
	bool bOk = false;
	Streaming = ULevelStreamingDynamic::LoadLevelInstanceBySoftObjectPtr(this, Level, FVector::ZeroVector, FRotator::ZeroRotator, bOk);
	if (!bOk || !Streaming) { UE_LOG(LogValdradaWorld, Warning, TEXT("%s: could not stream %s"), *GetName(), *Level.ToString()); return; }
	if (!CVarLevelCollision.GetValueOnGameThread()) Streaming->OnLevelLoaded.AddDynamic(this, &AValdradaLevelStreamer::HandleLevelLoaded);
}

void AValdradaLevelStreamer::HandleLevelLoaded()
{
	ULevel* L = Streaming ? Streaming->GetLoadedLevel() : nullptr;
	if (!L) return;
	for (AActor* B : L->Actors)
	{
		if (!B) continue;
		B->SetActorEnableCollision(false);
		TInlineComponentArray<UPrimitiveComponent*> Ps(B);
		for (UPrimitiveComponent* P : Ps)
		{
			P->SetCollisionEnabled(ECollisionEnabled::NoCollision);
			if (!CVarInstDF.GetValueOnGameThread() && P->IsA<UInstancedStaticMeshComponent>()) P->bAffectDistanceFieldLighting = false;
			P->SetCanEverAffectNavigation(false);
			P->SetGenerateOverlapEvents(false);
		}
	}
}

void AValdradaLevelStreamer::EndPlay(const EEndPlayReason::Type Reason)
{
	if (Streaming) { Streaming->SetIsRequestingUnloadAndRemoval(true); Streaming = nullptr; }
	Super::EndPlay(Reason);
}

bool AValdradaLevelStreamer::SetWanted(bool bWanted)
{
	if (!Streaming)
	{
		if (!bWanted || Level.IsNull()) return false;
		StartStreaming();
		return true;
	}
	if (Streaming->ShouldBeLoaded() == bWanted && Streaming->ShouldBeVisible() == bWanted) return false;
	Streaming->SetShouldBeLoaded(bWanted);
	Streaming->SetShouldBeVisible(bWanted);
	return true;
}

bool AValdradaLevelStreamer::IsReady() const
{
	ULevel* L = GetLoadedLevel();
	return L && L->bIsVisible;
}

ULevel* AValdradaLevelStreamer::GetLoadedLevel() const
{
	return Streaming ? Streaming->GetLoadedLevel() : nullptr;
}

// ---- the near/far swap
static const FName NAME_VN(TEXT("vn")), NAME_VF(TEXT("vf"));

static bool NearIsReady(AActor* A)
{
	if (AValdradaLevelStreamer* S = Cast<AValdradaLevelStreamer>(A)) return S->IsReady();
	if (AValdradaStreamCell* C = Cast<AValdradaStreamCell>(A)) return C->bBuilt;
	if (ILevelInstanceInterface* LI = Cast<ILevelInstanceInterface>(A))
	{
		ULevel* L = LI->IsLoaded() ? LI->GetLoadedLevel() : nullptr;
		return L && L->bIsVisible;
	}
	return A->HasActorBegunPlay();
}

bool UValdradaSwapSubsystem::ShouldCreateSubsystem(UObject* Outer) const
{
	// (only in the persistent city's levels, /Game/City/...: the takes' levels never pay for the swap's actor walk)
	const UWorld* W = Cast<UWorld>(Outer);
	return W && Super::ShouldCreateSubsystem(Outer) && W->GetOutermost()->GetName().Contains(TEXT("/Game/City/"));
}

void UValdradaSwapSubsystem::Tick(float DeltaTime)
{
	UWorld* W = GetWorld();
	if (!W || !W->IsGameWorld()) return;
	if (CVarBlock.GetValueOnGameThread() && !W->GetIsInBlockTillLevelStreamingCompleted())
	{
		bool bPending = false;
		for (ULevelStreaming* L : W->GetStreamingLevels())
			if (L && (L->IsStreamingStatePending() || (L->ShouldBeLoaded() && !L->IsLevelLoaded()))) { bPending = true; break; }
		if (bPending) W->BlockTillLevelStreamingCompleted();
	}
	{
		static double T0 = 0.0; static bool bDumped = false;
		const double Now0 = FPlatformTime::Seconds(); if (T0 == 0.0) T0 = Now0;
		const float After = CVarDumpAfter.GetValueOnGameThread();
		if (!bDumped && After > 0.f && Now0 - T0 > After && GEngine)
		{
			bDumped = true;
			TArray<FString> Cmds; CVarDumpCmds.GetValueOnGameThread().ParseIntoArray(Cmds, TEXT(";"));
			for (const FString& Cmd : Cmds) { UE_LOG(LogValdradaWorld, Display, TEXT("dump: %s"), *Cmd); GEngine->Exec(W, *Cmd); }
			// (the primitive components and their instances by class and by owning level kind)
			TMap<FString, TPair<int64, int64>> ByClass, ByLevel;
			for (TObjectIterator<UPrimitiveComponent> It; It; ++It)
			{
				UPrimitiveComponent* P = *It;
				if (!P || P->GetWorld() != W || !P->IsRegistered()) continue;
				int64 N = 1;
				if (UInstancedStaticMeshComponent* I = Cast<UInstancedStaticMeshComponent>(P)) N = I->GetInstanceCount();
				const FString Cls = P->GetClass()->GetName() + (P->IsVisible() && !(P->GetOwner() && P->GetOwner()->IsHidden()) ? TEXT("") : TEXT(" (hidden)"));
				FString Lv = P->GetOwner() ? P->GetOwner()->GetLevel()->GetOutermost()->GetName() : TEXT("?");
				if (Lv.Contains(TEXT("/CCB/"))) Lv = TEXT("blocks"); else if (Lv.Contains(TEXT("/CF/"))) Lv = TEXT("far"); else if (Lv.Contains(TEXT("L_City"))) Lv = P->GetOwner() && P->GetOwner()->IsA<AValdradaStreamCell>() ? TEXT("kit") : TEXT("city level"); 
				auto& A = ByClass.FindOrAdd(Cls); A.Key++; A.Value += N;
				auto& B = ByLevel.FindOrAdd(Lv); B.Key++; B.Value += N;
			}
			for (auto& KV : ByClass) if (KV.Value.Key > 100) UE_LOG(LogValdradaWorld, Display, TEXT("dump: components %s: %lld, instances %lld"), *KV.Key, KV.Value.Key, KV.Value.Value);
			int32 NL = 0; for (auto& KV : ByLevel) if (KV.Value.Key > 1000 && NL++ < 30) UE_LOG(LogValdradaWorld, Display, TEXT("dump: level %s: components %lld, instances %lld"), *KV.Key, KV.Value.Key, KV.Value.Value);
		}
	}
	{
		// the graphics tier: its console variables from the table (once per change)
		static int32 AppliedTier = -1;
		const int32 Tier = CVarTier.GetValueOnGameThread();
		if (Tier >= 0 && Tier != AppliedTier)
		{
			AppliedTier = Tier;
			static const TCHAR* Names[] = { TEXT("low"), TEXT("medium"), TEXT("high"), TEXT("cinematic") };
			FString Txt; TSharedPtr<FJsonObject> Root;
			if (FFileHelper::LoadFileToString(Txt, *CVarTierFile.GetValueOnGameThread()) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Txt), Root) && Root.IsValid())
			{
				const TSharedPtr<FJsonObject>* T = nullptr;
				if (Root->TryGetObjectField(Names[FMath::Clamp(Tier, 0, 3)], T))
					for (const auto& KV : (*T)->Values)
						if (IConsoleVariable* V = IConsoleManager::Get().FindConsoleVariable(*KV.Key)) { V->Set(*KV.Value->AsString(), ECVF_SetByConsole); }
				UE_LOG(LogValdradaWorld, Display, TEXT("tier: %s applied"), Names[FMath::Clamp(Tier, 0, 3)]);
			}
			else UE_LOG(LogValdradaWorld, Warning, TEXT("tier: no table at %s"), *CVarTierFile.GetValueOnGameThread());
		}
		auto Range = [&](float M, float& Applied, const TCHAR* Grid)
		{
			if (M > 0.f && M != Applied && W->GetWorldPartition() && GEngine)
			{
				Applied = M;
				const FString Cmd = FString::Printf(TEXT("wp.Runtime.OverrideRuntimeLoadingRange -grid=%s -range=%d"), Grid, int32(M * 100.f));
				UE_LOG(LogValdradaWorld, Display, TEXT("ranges: %s"), *Cmd); GEngine->Exec(W, *Cmd);
			}
		};
		static float AppliedM = 0.f, AppliedK = 0.f, AppliedF = 0.f, AppliedKN = 0.f;
		Range(CVarKitM.GetValueOnGameThread(), AppliedKN, TEXT("Kit"));
		Range(CVarFarM.GetValueOnGameThread(), AppliedF, TEXT("Far"));
		Range(CVarBlocksM.GetValueOnGameThread(), AppliedM, TEXT("Blocks"));
		// (the reduced kit's actors loaded as far as the near blocks reach: a near block draws its own reduced kit, below)
		{
			const float BK = CVarBlockKitM.GetValueOnGameThread(), KF = CVarKitFarM.GetValueOnGameThread();
			Range(NearBlocksM() > 0.f ? FMath::Max(KF, BK > 0.f ? BK : NearBlocksM() + 1500.f) : KF, AppliedK, TEXT("KitFar"));
		}
	}
	if (!CVarSwap.GetValueOnGameThread()) return;
	TMap<FName, bool> Ready; TArray<TPair<AActor*, FName>> Fars;
	TSet<FName> NearWanted;   // (block keys whose near level is in range: their reduced kit is built whatever its own range)
	// (2026-10-25: the near blocks and kit quads loaded by their distance to the lens when valdrada.BlocksRangeM /
	// valdrada.KitRangeM are set: World Partition's grid ranges did not bound them, a block's bounds a little over its
	// 1 km cell put it in a coarser cell, and the low tier loaded 69 blocks at a 600 m range. A near actor out of range
	// is not ready, so its far stand-in stays.)
	// (2026-10-26, holes over far Brooklyn and Queens: a key counted as ready while its near actor was merely in range, and
	// with no tier every block World Partition loaded (~380, to ~11 km) hid its far stand-in. A far stand-in is hidden only
	// when every near actor of its key is in range, loaded and visible; a near block leaving the range is kept until its far
	// stand-ins are loaded and visible.)
	bool bStreamChanged = false;
	const float NearBM = NearBlocksM() * 100.f, NearKM = CVarKitM.GetValueOnGameThread() * 100.f;
	APlayerController* PC0 = W->GetFirstPlayerController();
	const bool bEye = PC0 && PC0->PlayerCameraManager && !PC0->PlayerCameraManager->GetCameraLocation().IsNearlyZero();
	const FVector Eye0 = bEye ? PC0->PlayerCameraManager->GetCameraLocation() : FVector::ZeroVector;
	for (TActorIterator<AActor> It(W); It; ++It)
	{
		AActor* A = *It;
		if (!A || A->Tags.Num() < 2) continue;
		if (A->Tags[0] == NAME_VN)
		{
			bool bIn = true;
			if (AValdradaLevelStreamer* St = Cast<AValdradaLevelStreamer>(A))
			{
				if (NearBM > 0.f)
				{
					bIn = bEye && (!St->StreamBounds.IsValid || St->StreamBounds.ComputeSquaredDistanceToPoint(Eye0) < NearBM * NearBM);
					const bool* FRp = FarReadyPrev.Find(A->Tags[1]);
					const bool bKeep = !bIn && St->IsReady() && FRp && !*FRp;   // (until the far stand-in shows)
					if (bEye) bStreamChanged |= St->SetWanted(bIn || bKeep);
				}
			}
			else if (AValdradaStreamCell* Ce = Cast<AValdradaStreamCell>(A))
			{
				if (NearKM > 0.f)
				{
					bIn = bEye && (!Ce->StreamBounds.IsValid || Ce->StreamBounds.ComputeSquaredDistanceToPoint(Eye0) < NearKM * NearKM);
					if (bEye) { if (bIn && !Ce->bBuilt) Ce->Build(); else if (!bIn && Ce->bBuilt) Ce->Clear(); }
				}
			}
			if (bIn && A->IsA<AValdradaLevelStreamer>()) NearWanted.Add(A->Tags[1]);
			bool* R = Ready.Find(A->Tags[1]);
			const bool bOk = bIn && NearIsReady(A);
			if (R) *R = *R && bOk; else Ready.Add(A->Tags[1], bOk);
		}
		else if (A->Tags[0] == NAME_VF) Fars.Emplace(A, A->Tags[1]);
	}
	// (blocks beyond valdrada.RTRangeM out of the ray tracing scene: each block's meshes held ray tracing geometry,
	// 4.25 GB of BLAS for 28,500 meshes over a 4 km reach)
	const float RTM = CVarRTRangeM.GetValueOnGameThread();
	APlayerController* PC = W->GetFirstPlayerController();
	if (RTM > 0.f && PC && PC->PlayerCameraManager)
	{
		const FVector Eye = PC->PlayerCameraManager->GetCameraLocation();
		for (TActorIterator<AValdradaLevelStreamer> It(W); It; ++It)
		{
			AValdradaLevelStreamer* S = *It;
			if (S->Tags.Num() < 1 || S->Tags[0] != NAME_VN) continue;
			ULevel* L = S->GetLoadedLevel(); if (!L) continue;
			const bool bIn = !S->StreamBounds.IsValid || FMath::Sqrt(S->StreamBounds.ComputeSquaredDistanceToPoint(Eye)) < RTM * 100.f;
			bool* Prev = RTIn.Find(L);
			if (Prev && *Prev == bIn) continue;
			RTIn.Add(L, bIn);
			for (AActor* B : L->Actors)
				if (B) { TInlineComponentArray<UPrimitiveComponent*> Ps(B); for (UPrimitiveComponent* P : Ps) if (P->bVisibleInRayTracing != bIn) { P->bVisibleInRayTracing = bIn; P->MarkRenderStateDirty(); } }
		}
	}
	int32 NR = 0; for (const auto& KV : Ready) NR += KV.Value ? 1 : 0;
	int32 H = 0, S = 0;
	TMap<FName, bool> FarReady;
	for (const auto& F : Fars)
	{
		AActor* A = F.Key; bool bHide = Ready.FindRef(F.Value);
		bool bRanged = false;
		{   // (far stand-ins and reduced kit beyond their tier's range dropped as well: valdrada.FarRangeM, valdrada.KitFarRangeM)
			const bool bCell = A->IsA<AValdradaStreamCell>();
			const float FM = (bCell ? CVarKitFarM.GetValueOnGameThread() : CVarFarM.GetValueOnGameThread()) * 100.f;
			const FBox* Bx = bCell ? &Cast<AValdradaStreamCell>(A)->StreamBounds : (A->IsA<AValdradaLevelStreamer>() ? &Cast<AValdradaLevelStreamer>(A)->StreamBounds : nullptr);
			// (2026-10-26: a near block beyond the reduced kit's range was drawn without the kit it holds (street and lot
			// pieces among it): cracks to the void 1.5-4 km out. The reduced kit of a quad in a near block in range is built
			// with the block; elsewhere the kit's own range (the level's KitFar grid, 1.5 km, when no tier sets one).)
			const float FMe = bCell && FM <= 0.f && NearBlocksM() > 0.f ? 150000.f : FM;
			bool bOwnBlock = false;
			if (bCell)
			{
				FString Ks = F.Value.ToString(), Sx, Sz;
				if (Ks.RemoveFromStart(TEXT("Q_")) && Ks.Split(TEXT("_"), &Sx, &Sz))
					bOwnBlock = NearWanted.Contains(FName(*FString::Printf(TEXT("B_%d_%d"), FMath::FloorToInt(FCString::Atoi(*Sx) / 4.f), FMath::FloorToInt(FCString::Atoi(*Sz) / 4.f))));
			}
			const float BKM = CVarBlockKitM.GetValueOnGameThread() * 100.f;
			if (bOwnBlock && BKM > 0.f && bEye && Bx && Bx->IsValid && Bx->ComputeSquaredDistanceToPoint(Eye0) > BKM * BKM) bOwnBlock = false;
			if (FMe > 0.f && bEye && Bx && Bx->IsValid && !bOwnBlock && Bx->ComputeSquaredDistanceToPoint(Eye0) > FMe * FMe) { bHide = true; bRanged = true; }
		}
		bHide ? ++H : ++S;
		if (AValdradaLevelStreamer* St = Cast<AValdradaLevelStreamer>(A))
		{
			// (no far stand-in is loaded before the lens is known, nor for a block already in range: its near level comes in
			// this tick (block streaming); loading both at once made the capped high tier's peak at the first frame, 2026-10-27)
			bool bComing = false;   // (a near block in range for under 5 s that is not visible yet; one that never loads lets its far in)
			if (NearWanted.Contains(F.Value) && !Ready.FindRef(F.Value))
			{
				const double Now_ = FPlatformTime::Seconds(); const double T_ = NearWaitSince.FindOrAdd(F.Value, Now_);
				bComing = Now_ - T_ < 5.0;
			}
			if (!bHide && !St->GetLoadedLevel() && (!bEye || bComing)) { bHide = true; bRanged = true; }
			bStreamChanged |= St->SetWanted(!bHide);   // (unloaded, not hidden)
			if (!bRanged) { bool* FR = FarReady.Find(F.Value); const bool bR = St->IsReady(); if (FR) *FR = *FR && bR; else FarReady.Add(F.Value, bR); }
			ULevel* FL = St->GetLoadedLevel();
			if (FL && !CVarFarRT.GetValueOnGameThread() && !FarRTDone.Contains(FL))
			{
				FarRTDone.Add(FL);
				for (AActor* B : FL->Actors)
					if (B) { TInlineComponentArray<UInstancedStaticMeshComponent*> Ics(B); for (UInstancedStaticMeshComponent* Ic : Ics) if (Ic->bVisibleInRayTracing) { Ic->bVisibleInRayTracing = false; Ic->MarkRenderStateDirty(); } }
			}
			continue;
		}
		if (AValdradaStreamCell* Ce = Cast<AValdradaStreamCell>(A))
		{
			const bool bBuilt = Ce->bBuilt;   // (by flag: an empty table rebuilt every tick held the game thread for minutes)
			if (bHide && bBuilt) Ce->Clear(); else if (!bHide && !bBuilt) Ce->Build();
			continue;
		}
		ULevel* Lv = nullptr;
		ILevelInstanceInterface* LI = Cast<ILevelInstanceInterface>(A);
		if (LI) { Lv = LI->IsLoaded() ? LI->GetLoadedLevel() : nullptr; if (!Lv) continue; }
		TPair<TWeakObjectPtr<ULevel>, bool>* Prev = Applied.Find(A);
		if (Prev && Prev->Value == bHide && Prev->Key.Get() == Lv) continue;
		if (LI) { for (AActor* B : Lv->Actors) if (B && B->IsHidden() != bHide) B->SetActorHiddenInGame(bHide); }
		else if (A->IsHidden() != bHide) A->SetActorHiddenInGame(bHide);
		Applied.Add(A, TPair<TWeakObjectPtr<ULevel>, bool>(Lv, bHide));
	}
	FarReadyPrev = MoveTemp(FarReady);
	for (auto It = NearWaitSince.CreateIterator(); It; ++It) if (!NearWanted.Contains(It.Key()) || Ready.FindRef(It.Key())) It.RemoveCurrent();
	// (offline renders: what this tick asked of streaming is done before the frame, so no frame shows a block's far
	// stand-in unloaded before the block is in, or the reverse)
	if (bStreamChanged && CVarBlock.GetValueOnGameThread() && !W->GetIsInBlockTillLevelStreamingCompleted()) W->BlockTillLevelStreamingCompleted();
	NearReady = NR; FarHidden = H; FarShown = S;
	const float LogS = CVarLog.GetValueOnGameThread(); const double Now = FPlatformTime::Seconds();
	if (LogS > 0.f && Now - LastLog > LogS)
	{
		LastLog = Now;
		UE_LOG(LogValdradaWorld, Display, TEXT("swap: %d of %d near keys ready, far %d hidden %d shown, %d streaming levels"), NR, Ready.Num(), H, S, W->GetStreamingLevels().Num());
	}
}

// ---- the shot server
bool UValdradaShotServer::ShouldCreateSubsystem(UObject* Outer) const
{
	const UWorld* W = Cast<UWorld>(Outer);
	return W && Super::ShouldCreateSubsystem(Outer) && W->GetOutermost()->GetName().Contains(TEXT("/Game/City/"));
}

void UValdradaShotServer::Tick(float DeltaTime)
{
	const FString Dir = CVarServer.GetValueOnGameThread();
	if (Dir.IsEmpty() || !GEngine) return;
	UMoviePipelineQueueEngineSubsystem* S = GEngine->GetEngineSubsystem<UMoviePipelineQueueEngineSubsystem>();
	if (!S) return;
	const double Now = FPlatformTime::Seconds();
	if (!Current.IsEmpty())
	{
		const bool bR = S->IsRendering();
		if (bR) { bWasRendering = true; return; }
		if (!bWasRendering && Now - Started < 30.0) return;
		const FString Out = FString::Printf(TEXT("ok %.1f\n"), Now - Started);
		FFileHelper::SaveStringToFile(Out, *(Dir / Current + TEXT(".done")));
		UE_LOG(LogValdradaWorld, Display, TEXT("shot server: %s finished in %.1f s"), *Current, Now - Started);
		Current.Reset(); bWasRendering = false;
		return;
	}
	if (Now - LastScan < 1.0) return;
	LastScan = Now;
	TArray<FString> Reqs;
	IFileManager::Get().FindFiles(Reqs, *(Dir / TEXT("*.req")), true, false);
	if (Reqs.Num() == 0) return;
	Reqs.Sort();
	const FString Name = FPaths::GetBaseFilename(Reqs[0]);
	FString Body; FFileHelper::LoadFileToString(Body, *(Dir / Reqs[0]));
	IFileManager::Get().Move(*(Dir / Name + TEXT(".running")), *(Dir / Reqs[0]));
	FString Manifest, QueuePath, OutDir;
	TArray<FString> Lines; Body.ParseIntoArrayLines(Lines);
	for (const FString& L : Lines)
	{
		if (L.StartsWith(TEXT("manifest="))) Manifest = L.Mid(9).TrimStartAndEnd();
		else if (L.StartsWith(TEXT("queue="))) QueuePath = L.Mid(6).TrimStartAndEnd();
		else if (L.StartsWith(TEXT("out="))) OutDir = L.Mid(4).TrimStartAndEnd();
	}
	auto Fail = [&](const TCHAR* Why)
	{
		UE_LOG(LogValdradaWorld, Warning, TEXT("shot server: %s failed: %s"), *Name, Why);
		FFileHelper::SaveStringToFile(FString::Printf(TEXT("failed %s\n"), Why), *(Dir / Name + TEXT(".done")));
	};
	// (a queue asset, /Game/City/MRQ/Q_<shot>, in a cooked build; a manifest file in the editor's game)
	UMoviePipelineQueue* Q = !QueuePath.IsEmpty() ? Cast<UMoviePipelineQueue>(FSoftObjectPath(QueuePath).TryLoad())
		: (Manifest.IsEmpty() ? nullptr : UMoviePipelineBlueprintLibrary::LoadManifestFileFromString(Manifest));
	if (!Q || Q->GetJobs().Num() == 0) { Fail(TEXT("no queue or no job")); return; }
	UMoviePipelineExecutorJob* Src = Q->GetJobs()[0];
	ULevelSequence* Seq = Cast<ULevelSequence>(Src->Sequence.TryLoad());
	if (!Seq) { Fail(TEXT("no sequence")); return; }
	UMoviePipelineExecutorJob* Job = S->AllocateJob(Seq);
	if (!Job) { Fail(TEXT("no job")); return; }
	Job->SetConfiguration(Src->GetConfiguration());
	if (!OutDir.IsEmpty())
		if (UMoviePipelineOutputSetting* OS = Job->GetConfiguration()->FindSetting<UMoviePipelineOutputSetting>()) OS->OutputDirectory.Path = OutDir;
	bool bChanged = false; UMoviePipelineBlueprintLibrary::UpdateJobShotListFromSequence(Seq, Job, bChanged);
	Current = Name; Started = Now; bWasRendering = false;
	UE_LOG(LogValdradaWorld, Display, TEXT("shot server: rendering %s (%s)"), *Name, *Seq->GetPathName());
	S->RenderJob(Job);
}

// ---- editor helpers
FString UValdradaWorldLib::SetSpatialHashGrids(UWorld* World, const TArray<FName>& Names, const TArray<int32>& CellSizes, const TArray<float>& Ranges, bool bBlockOnSlowStreaming)
{
#if WITH_EDITOR
	UWorldPartition* WP = World ? World->GetWorldPartition() : nullptr;
	if (!WP) return TEXT("error: not a World Partition level");
	FObjectProperty* HP = FindFProperty<FObjectProperty>(UWorldPartition::StaticClass(), TEXT("RuntimeHash"));
	if (!HP) return TEXT("error: no RuntimeHash property");
	UObject* H = HP->GetObjectPropertyValue_InContainer(WP);
	if (!H || !H->IsA<UWorldPartitionRuntimeSpatialHash>())
	{
		WP->Modify();
		UWorldPartitionRuntimeSpatialHash* NH = NewObject<UWorldPartitionRuntimeSpatialHash>(WP, NAME_None, RF_Transactional);
		NH->SetDefaultValues();
		HP->SetObjectPropertyValue_InContainer(WP, NH);
		H = NH;
	}
	FArrayProperty* GP = FindFProperty<FArrayProperty>(UWorldPartitionRuntimeSpatialHash::StaticClass(), TEXT("Grids"));
	if (!GP) return TEXT("error: no Grids property");
	H->Modify();
	TArray<FSpatialHashRuntimeGrid>* Grids = GP->ContainerPtrToValuePtr<TArray<FSpatialHashRuntimeGrid>>(H);
	Grids->Reset();
	for (int32 I = 0; I < Names.Num(); ++I)
	{
		FSpatialHashRuntimeGrid G;
		G.GridName = Names[I]; G.CellSize = CellSizes.IsValidIndex(I) ? CellSizes[I] : 25600; G.LoadingRange = Ranges.IsValidIndex(I) ? Ranges[I] : 25600.f;
		G.bBlockOnSlowStreaming = bBlockOnSlowStreaming; G.Priority = I;
		Grids->Add(G);
	}
	WP->MarkPackageDirty(); World->PersistentLevel->MarkPackageDirty();
	return DescribeRuntimeHash(World);
#else
	return TEXT("error: editor only");
#endif
}

FString UValdradaWorldLib::DescribeRuntimeHash(UWorld* World)
{
#if WITH_EDITOR
	UWorldPartition* WP = World ? World->GetWorldPartition() : nullptr;
	if (!WP) return TEXT("not a World Partition level");
	FObjectProperty* HP = FindFProperty<FObjectProperty>(UWorldPartition::StaticClass(), TEXT("RuntimeHash"));
	UObject* H = HP ? HP->GetObjectPropertyValue_InContainer(WP) : nullptr;
	FString Out = FString::Printf(TEXT("hash %s"), H ? *H->GetClass()->GetName() : TEXT("none"));
	if (H && H->IsA<UWorldPartitionRuntimeSpatialHash>())
		if (FArrayProperty* GP = FindFProperty<FArrayProperty>(UWorldPartitionRuntimeSpatialHash::StaticClass(), TEXT("Grids")))
			for (const FSpatialHashRuntimeGrid& G : *GP->ContainerPtrToValuePtr<TArray<FSpatialHashRuntimeGrid>>(H))
				Out += FString::Printf(TEXT("; %s cell %d range %.0f block %d"), *G.GridName.ToString(), G.CellSize, G.LoadingRange, G.bBlockOnSlowStreaming ? 1 : 0);
	return Out;
#else
	return TEXT("editor only");
#endif
}
