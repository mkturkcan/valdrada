// render.capture -> render.result. Each sensor group (the sensors that share a pose, fov and size) has its own scene
// captures, the RGB one keeping its rendering state between frames, so its temporal history (TSR, Lumen's caches, the
// exposure) converges as if it were the only camera; a camera that is new or has jumped renders WarmFramesOnCut engine
// frames before its image is read, others WarmFrames (Nanite's streaming and Lumen's caches follow frame by frame). The
// planes go back in the protocol's formats, rows top to bottom: rgba8, and depth_f32 in metres along the view axis with
// the camera's far distance for pixels with no geometry (depth_max).
#include "ValdradaClient.h"
#include "ValdradaLink.h"
#include "ValdradaFrames.h"
#include "ValdradaPathTraceExt.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Engine/TextureRenderTarget2D.h"
#include "TextureResource.h"
#include "RenderingThread.h"
#include "Materials/MaterialInstanceDynamic.h"

DEFINE_LOG_CATEGORY_STATIC(LogValdradaCapture, Log, All);

void AValdradaClient::OnCapture(const TSharedPtr<FJsonObject>& C)
{
	FCaptureJob J;
	J.Req = C;
	double V = 0;
	C->TryGetNumberField(TEXT("capture"), V); J.Id = int32(V);
	C->TryGetNumberField(TEXT("frame"), V); J.Frame = int64(V);
	C->TryGetNumberField(TEXT("width"), V); J.Width = FMath::Clamp(int32(V), 1, 8192);
	C->TryGetNumberField(TEXT("height"), V); J.Height = FMath::Clamp(int32(V), 1, 8192);
	const TArray<TSharedPtr<FJsonValue>>* Outs = nullptr;
	if (C->TryGetArrayField(TEXT("outputs"), Outs)) for (const TSharedPtr<FJsonValue>& O : *Outs) J.Outputs.Add(O->AsString());
	const TSharedPtr<FJsonObject>* Cam = nullptr;
	double P[3], Q[4];
	if (!C->TryGetObjectField(TEXT("camera"), Cam) || !Valdrada::Num3(*Cam, TEXT("pos"), P, 3) || !Valdrada::Num3(*Cam, TEXT("quat"), Q, 4))
	{
		Fail(J, TEXT("bad_request"), TEXT("render.capture without a camera"));
		return;
	}
	double Fov = 58.7, Aspect = double(J.Width) / double(J.Height), Far = 20000.0;
	(*Cam)->TryGetNumberField(TEXT("fov_y_deg"), Fov);
	(*Cam)->TryGetNumberField(TEXT("aspect"), Aspect);
	(*Cam)->TryGetNumberField(TEXT("far"), Far);
	J.Pose = FTransform(Valdrada::CameraRotation(Q[0], Q[1], Q[2], Q[3]), Valdrada::Pos(P[0], P[1], P[2]));
	J.HFovDeg = Valdrada::HFov(Fov, Aspect);
	J.Far = Far;
	for (const FString& O : J.Outputs)
		if (O != TEXT("rgb") && O != TEXT("depth") && O != TEXT("albedo") && O != TEXT("normal") && !(O == TEXT("semantic") && SemanticMat))
		{
			Fail(J, TEXT("unsupported_output"), FString::Printf(TEXT("this renderer does not serve %s yet"), *O));
			return;
		}
	// the group: its sensors (bridge.js groups by parent, relative pose, fov and size)
	FString Sensors;
	const TArray<TSharedPtr<FJsonValue>>* S = nullptr;
	if (C->TryGetArrayField(TEXT("sensors"), S)) for (const TSharedPtr<FJsonValue>& Id : *S) Sensors += FString::Printf(TEXT("%d,"), int32(Id->AsNumber()));
	// the capture mode (a replay of a take: render.capture `mode`, `spp`, `warm`, `burst`, fields the core does not send)
	C->TryGetStringField(TEXT("mode"), J.Mode);
	if (J.Mode != TEXT("pathtrace")) J.Mode = TEXT("lumen");
	double Spp = 1;
	if (C->TryGetNumberField(TEXT("spp"), Spp)) J.Spp = FMath::Clamp(int32(Spp), 1, 4096);
	C->TryGetBoolField(TEXT("burst"), J.bBurst);
	C->TryGetBoolField(TEXT("denoise"), J.bDenoise);
	J.Key = FString::Printf(TEXT("%s%dx%d%s"), *Sensors, J.Width, J.Height, *J.Mode);
	const TSharedPtr<FJsonObject>* Ex = nullptr;
	if (C->TryGetObjectField(TEXT("exposure"), Ex))
	{
		FString Mode;
		if ((*Ex)->TryGetStringField(TEXT("mode"), Mode)) J.bAutoExposure = Mode != TEXT("manual");
		double Comp = 0;
		if ((*Ex)->TryGetNumberField(TEXT("compensation"), Comp)) J.ExposureComp = float(Comp);
	}
	FCam& K = CamFor(J);
	const bool bCut = !K.bUsed || FVector::Dist(K.Last.GetLocation(), J.Pose.GetLocation()) > 300.0
		|| K.Last.GetRotation().AngularDistance(J.Pose.GetRotation()) > FMath::DegreesToRadians(10.0);
	J.WarmLeft = J.Outputs.Contains(TEXT("rgb")) ? (bCut ? WarmFramesOnCut : WarmFrames) : 0;
	double Warm = -1;
	if (C->TryGetNumberField(TEXT("warm"), Warm) && Warm >= 0) J.WarmLeft = int32(Warm);
	// the path tracer adds one sample a render and denoises the last: spp - 1 renders before the one read
	if (J.Mode == TEXT("pathtrace")) J.WarmLeft = J.Outputs.Contains(TEXT("rgb")) ? J.Spp - 1 : 0;
	J.bCut = bCut;
	J.T0 = FPlatformTime::Seconds();
	if (Link) Link->NotePending(J.Id, true);
	Captures.Add(J);
}

AValdradaClient::FCam& AValdradaClient::CamFor(const FCaptureJob& J)
{
	FCam& K = Cams.FindOrAdd(J.Key);
	// (bLinear: the target stores what the renderer writes; otherwise it is an sRGB target, the final colour encoded as a
	// display's (Movie Render Queue's frames are; with a linear target the RGB came back unencoded, about 2 EV dark in the
	// mid-tones, the shade crushed, the hues saturated)
	auto Make = [&](ESceneCaptureSource Src, EPixelFormat Fmt, TObjectPtr<UTextureRenderTarget2D>& RT, bool bLinear = true) -> USceneCaptureComponent2D*
	{
		RT = NewObject<UTextureRenderTarget2D>(this);
		RT->bAutoGenerateMips = false;
		RT->ClearColor = FLinearColor::Black;
		RT->InitCustomFormat(J.Width, J.Height, Fmt, bLinear);
		RT->UpdateResourceImmediate(true);
		KeepAlive.Add(RT);
		USceneCaptureComponent2D* C = NewObject<USceneCaptureComponent2D>(this);
		C->SetupAttachment(RootComponent);
		C->bCaptureEveryFrame = false;
		C->bCaptureOnMovement = false;
		C->CaptureSource = Src;
		C->TextureTarget = RT;
		C->ShowFlags.SetMotionBlur(false);
		C->RegisterComponent();
		return C;
	};
	if (!K.Rgb && J.Outputs.Contains(TEXT("rgb")))
	{
		K.Rgb = Make(SCS_FinalColorLDR, PF_B8G8R8A8, K.RgbRT, false);
		K.Rgb->bAlwaysPersistRenderingState = true;
		K.Rgb->bUseRayTracingIfEnabled = true;
		// a scene capture turns Lumen off unless its own settings ask for it (SceneCaptureRendering.cpp): the world's GI and
		// reflections, its surface cache at full resolution
		FPostProcessSettings& PS = K.Rgb->PostProcessSettings;
		PS.bOverride_DynamicGlobalIlluminationMethod = true; PS.DynamicGlobalIlluminationMethod = EDynamicGlobalIlluminationMethod::Lumen;
		PS.bOverride_ReflectionMethod = true; PS.ReflectionMethod = EReflectionMethod::Lumen;
		PS.bOverride_LumenSurfaceCacheResolution = true; PS.LumenSurfaceCacheResolution = 1.f;
		K.Rgb->PostProcessBlendWeight = 1.f;
		if (J.Mode == TEXT("pathtrace"))
		{
			// Unreal's path tracer in place of the raster frame: 3 bounces, the denoiser (NNEDenoiser) on the last sample;
			// the accumulation starts again whenever the camera or the scene moved
			K.Rgb->ShowFlags.SetPathTracing(true);
			PS.bOverride_PathTracingMaxBounces = true; PS.PathTracingMaxBounces = 3;
			PS.bOverride_PathTracingSamplesPerPixel = true; PS.PathTracingSamplesPerPixel = J.Spp;
			PS.bOverride_PathTracingEnableDenoiser = true; PS.PathTracingEnableDenoiser = true;
		}
		// its own film look (the world's, M_bx_film, blended over at full weight), so its exposure is its own
		if (FilmMID)
		{
			K.Film = UMaterialInstanceDynamic::Create(FilmMID->Parent, this);
			K.Film->CopyParameterOverrides(FilmMID);
			KeepAlive.Add(K.Film);
			PS.WeightedBlendables.Array.Add(FWeightedBlendable(1.f, K.Film));
		}
	}
	if (!K.Sem && J.Outputs.Contains(TEXT("semantic")))
	{
		// the class ids as colour (M_client_semantic after the tonemapper), without the temporal jitter that would smear them
		K.Sem = Make(SCS_FinalColorLDR, PF_B8G8R8A8, K.SemRT);
		K.Sem->PostProcessSettings.WeightedBlendables.Array.Add(FWeightedBlendable(1.f, SemanticMat));
		K.Sem->PostProcessBlendWeight = 1.f;
		// (a post-process material applies only to a view with a state: UMaterialInterface::OverrideBlendableSettings)
		K.Sem->bAlwaysPersistRenderingState = true;
		K.Sem->ShowFlags.SetAntiAliasing(false);
		K.Sem->ShowFlags.SetTemporalAA(false);
		K.Sem->ShowFlags.SetBloom(false);
		K.Sem->ShowFlags.SetDynamicShadows(false);
	}
	// the denoiser's guides for a path-traced frame denoised outside (tools/core/oidn_worker.py): the surfaces' base colour
	// and their world normals from the raster passes, without temporal jitter
	if (!K.Alb && J.Outputs.Contains(TEXT("albedo")))
	{
		K.Alb = Make(SCS_BaseColor, PF_B8G8R8A8, K.AlbRT);
		K.Alb->ShowFlags.SetAntiAliasing(false);
		K.Alb->ShowFlags.SetTemporalAA(false);
	}
	if (!K.Nrm && J.Outputs.Contains(TEXT("normal")))
	{
		K.Nrm = Make(SCS_Normal, PF_FloatRGBA, K.NrmRT);
		K.Nrm->ShowFlags.SetAntiAliasing(false);
		K.Nrm->ShowFlags.SetTemporalAA(false);
	}
	// (semantic reads the depth too: the sky is where nothing is drawn)
	if (!K.Depth && (J.Outputs.Contains(TEXT("depth")) || J.Outputs.Contains(TEXT("semantic"))))
	{
		K.Depth = Make(SCS_SceneDepth, PF_A32B32G32R32F, K.DepthRT);
		K.Depth->ShowFlags.SetAntiAliasing(false);
		K.Depth->ShowFlags.SetTemporalAA(false);
		K.Depth->ShowFlags.SetLighting(false);
		K.Depth->ShowFlags.SetGlobalIllumination(false);
		K.Depth->ShowFlags.SetDynamicShadows(false);
	}
	return K;
}

void AValdradaClient::StepCaptures()
{
	if (Captures.Num() == 0) return;
	FCaptureJob& J = Captures[0];
	FCam& K = CamFor(J);
	for (USceneCaptureComponent2D* C : { K.Rgb.Get(), K.Depth.Get(), K.Sem.Get(), K.Alb.Get(), K.Nrm.Get() })
		if (C) { C->SetWorldLocationAndRotation(J.Pose.GetLocation(), J.Pose.GetRotation()); C->FOVAngle = J.HFovDeg; }
	if (K.Rgb && J.Mode == TEXT("pathtrace"))
	{
		K.Rgb->PostProcessSettings.PathTracingSamplesPerPixel = J.Spp;
		// (a new frame: its first render starts the accumulation; the remaining spp - 1 add to it, the last is denoised)
		if (PathTraceExt && J.WarmLeft == J.Spp - 1) PathTraceExt->bResetNext = true;
		K.Rgb->PostProcessSettings.PathTracingEnableDenoiser = J.bDenoise;
	}
	if (J.bBurst || J.Mode == TEXT("pathtrace"))
	{
		// every warm render in this tick: nothing moves between them
		ApplyExposure(K, J);
		if (J.TRender == 0) J.TRender = FPlatformTime::Seconds();
		for (; J.WarmLeft > 0; --J.WarmLeft) if (K.Rgb) { K.Rgb->CaptureScene(); ++J.Renders; }
	}
	if (J.WarmLeft > 0)
	{
		if (K.Rgb)
		{
			ApplyExposure(K, J);
			if (J.TRender == 0) J.TRender = FPlatformTime::Seconds();
			K.Rgb->CaptureScene();
			++J.Renders;
			// after a cut (a new camera, a teleport) each warm frame is metered, so the image read is exposed for its
			// own view; otherwise the last image's metering carries over (one tick behind, the view barely moved)
			if (J.bAutoExposure && J.bCut)
			{
				TArray<FColor> Px;
				if (FTextureRenderTargetResource* R = K.RgbRT->GameThread_GetRenderTargetResource())
					if (R->ReadPixels(Px)) Meter(K, J, Px);
			}
		}
		--J.WarmLeft;
		return;
	}
	FCaptureJob Done = MoveTemp(J);
	Captures.RemoveAt(0);
	Finish(Done);
}

void AValdradaClient::Finish(FCaptureJob& J)
{
	FCam& K = CamFor(J);
	const int64 NPx = int64(J.Width) * J.Height;
	TArray<TArray<uint8>> Planes;
	TSharedRef<FJsonObject> Timing = MakeShared<FJsonObject>();
	const double DepthMax = FMath::Min(J.Far, double(DepthMaxM));
	// the depth once (the depth output and the semantic sky both read it)
	TArray<float> Depth;
	if (K.Depth && (J.Outputs.Contains(TEXT("depth")) || J.Outputs.Contains(TEXT("semantic"))))
	{
		const double T = FPlatformTime::Seconds();
		K.Depth->CaptureScene();
		TArray<FLinearColor> Px;
		FTextureRenderTargetResource* R = K.DepthRT->GameThread_GetRenderTargetResource();
		if (!R || !R->ReadLinearColorPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("depth read back failed")); return; }
		Depth.SetNumUninitialized(NPx);
		const float Max = float(DepthMax);
		for (int64 I = 0; I < NPx; ++I)
		{
			const float M = Px[I].R * 0.01f;   // scene depth: centimetres along the view axis
			Depth[I] = (FMath::IsFinite(M) && M > 0.f && M < Max) ? M : Max;
		}
		Timing->SetNumberField(TEXT("depth_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
	}
	for (const FString& O : J.Outputs)
	{
		const double T = FPlatformTime::Seconds();
		TArray<uint8>& Out = Planes.AddDefaulted_GetRef();
		if (O == TEXT("rgb") && K.Rgb)
		{
			if (J.TRender == 0) J.TRender = FPlatformTime::Seconds();
			ApplyExposure(K, J);
			K.Rgb->CaptureScene();
			// (the breakdown: the frame's renders through the GPU, the path tracer's denoising included, then the
			// read back and the copy into the reply)
			FlushRenderingCommands();
			const double T1 = FPlatformTime::Seconds();
			TArray<FColor> Px;
			FTextureRenderTargetResource* R = K.RgbRT->GameThread_GetRenderTargetResource();
			if (!R || !R->ReadPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("rgb read back failed")); return; }
			const double T2 = FPlatformTime::Seconds();
			Timing->SetNumberField(TEXT("exposure_ev"), (J.bAutoExposure ? K.EV : 0.f) + J.ExposureComp);
			if (J.bAutoExposure) Meter(K, J, Px);
			Out.SetNumUninitialized(NPx * 4);
			for (int64 I = 0; I < NPx; ++I) { const FColor& C = Px[I]; uint8* D = Out.GetData() + I * 4; D[0] = C.R; D[1] = C.G; D[2] = C.B; D[3] = 255; }
			Timing->SetNumberField(TEXT("render_ms"), (T1 - J.TRender) * 1000.0);
			Timing->SetNumberField(TEXT("readback_ms"), (T2 - T1) * 1000.0);
			Timing->SetNumberField(TEXT("convert_ms"), (FPlatformTime::Seconds() - T2) * 1000.0);
			Timing->SetNumberField(TEXT("renders"), J.Renders + 1);
			Timing->SetNumberField(TEXT("rgb_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
		}
		else if (O == TEXT("depth") && Depth.Num() == NPx)
		{
			Out.SetNumUninitialized(NPx * 4);
			FMemory::Memcpy(Out.GetData(), Depth.GetData(), NPx * 4);
		}
		else if (O == TEXT("albedo") && K.Alb)
		{
			K.Alb->CaptureScene();
			TArray<FColor> Px;
			FTextureRenderTargetResource* R = K.AlbRT->GameThread_GetRenderTargetResource();
			if (!R || !R->ReadPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("albedo read back failed")); return; }
			Out.SetNumUninitialized(NPx * 4);
			for (int64 I = 0; I < NPx; ++I) { const FColor& C = Px[I]; uint8* D = Out.GetData() + I * 4; D[0] = C.R; D[1] = C.G; D[2] = C.B; D[3] = 255; }
			Timing->SetNumberField(TEXT("albedo_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
		}
		else if (O == TEXT("normal") && K.Nrm)
		{
			// (world normals as rgba8: 0.5 + 0.5 n)
			K.Nrm->CaptureScene();
			TArray<FLinearColor> Px;
			FTextureRenderTargetResource* R = K.NrmRT->GameThread_GetRenderTargetResource();
			if (!R || !R->ReadLinearColorPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("normal read back failed")); return; }
			Out.SetNumUninitialized(NPx * 4);
			for (int64 I = 0; I < NPx; ++I)
			{
				const FLinearColor& C = Px[I]; uint8* D = Out.GetData() + I * 4;
				D[0] = uint8(FMath::Clamp(0.5f + 0.5f * C.R, 0.f, 1.f) * 255.f + 0.5f); D[1] = uint8(FMath::Clamp(0.5f + 0.5f * C.G, 0.f, 1.f) * 255.f + 0.5f);
				D[2] = uint8(FMath::Clamp(0.5f + 0.5f * C.B, 0.f, 1.f) * 255.f + 0.5f); D[3] = 255;
			}
			Timing->SetNumberField(TEXT("normal_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
		}
		else if (O == TEXT("semantic") && K.Sem)
		{
			K.Sem->CaptureScene();
			TArray<FColor> Px;
			FTextureRenderTargetResource* R = K.SemRT->GameThread_GetRenderTargetResource();
			if (!R || !R->ReadPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("semantic read back failed")); return; }
			Out.SetNumUninitialized(NPx);
			const float SkyAt = float(DepthMax) * 0.999f;
			for (int64 I = 0; I < NPx; ++I)
			{
				const uint8 C = Px[I].R;
				// (no class and nothing drawn: sky, 1)
				Out[I] = (C == 0 && Depth.Num() == NPx && Depth[I] >= SkyAt) ? 1 : C;
			}
			Timing->SetNumberField(TEXT("semantic_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
		}
	}
	K.Last = J.Pose;
	K.bUsed = true;
	TSharedRef<FJsonObject> P = MakeShared<FJsonObject>();
	P->SetNumberField(TEXT("capture"), J.Id);
	P->SetNumberField(TEXT("frame"), double(J.Frame));
	P->SetNumberField(TEXT("width"), J.Width);
	P->SetNumberField(TEXT("height"), J.Height);
	TArray<TSharedPtr<FJsonValue>> Outs;
	for (const FString& O : J.Outputs) Outs.Add(MakeShared<FJsonValueString>(O));
	P->SetArrayField(TEXT("outputs"), Outs);
	P->SetField(TEXT("labels"), MakeShared<FJsonValueNull>());
	if (J.Outputs.Contains(TEXT("depth"))) P->SetNumberField(TEXT("depth_max"), DepthMax); else P->SetField(TEXT("depth_max"), MakeShared<FJsonValueNull>());
	Timing->SetNumberField(TEXT("total_ms"), (FPlatformTime::Seconds() - J.T0) * 1000.0);
	P->SetObjectField(TEXT("timing"), Timing);
	TArray<TArrayView<const uint8>> Blobs;
	for (const TArray<uint8>& B : Planes) Blobs.Add(TArrayView<const uint8>(B.GetData(), B.Num()));
	if (Link) Link->NotePending(J.Id, false);
	SendRequest(TEXT("render.result"), P, Blobs);
}

void AValdradaClient::Fail(const FCaptureJob& J, const FString& Code, const FString& Message)
{
	Note(FString::Printf(TEXT("capture %d: %s"), J.Id, *Message));
	if (Link) Link->NotePending(J.Id, false);
	TSharedRef<FJsonObject> P = MakeShared<FJsonObject>();
	P->SetNumberField(TEXT("capture"), J.Id);
	P->SetNumberField(TEXT("frame"), double(J.Frame));
	TSharedRef<FJsonObject> E = MakeShared<FJsonObject>();
	E->SetStringField(TEXT("code"), Code);
	E->SetStringField(TEXT("message"), Message);
	P->SetObjectField(TEXT("error"), E);
	SendRequest(TEXT("render.result"), P);
}

// Exposure (a camera sensor exposes for its view, as CARLA's RGB camera does): the film look maps radiance x Expo through
// AgX and reads no eye adaptation, so the metering is the client's own. Each metered image's median luma (sRGB) is brought
// toward the time of day's key, in EV over the time of day's fixed exposure and within its clamps, so 125th Street at day
// keeps the fixed exposure's look, a street canyon is lifted, and golden hour, dusk and night stay what they are.
namespace
{
	struct FExposureKey { float Median, MinEV, MaxEV; };
	FExposureKey KeyOf(const FString& Tod)
	{
		if (Tod == TEXT("golden")) return { 0.13f, -2.f, 2.5f };
		if (Tod == TEXT("dusk")) return { 0.09f, -1.5f, 2.f };
		if (Tod == TEXT("night")) return { 0.06f, -1.f, 1.5f };
		return { 0.15f, -2.f, 3.f };
	}
}

void AValdradaClient::ApplyExposure(FCam& K, const FCaptureJob& J)
{
	if (!K.Film) return;
	const float EV = (J.bAutoExposure ? K.EV : 0.f) + J.ExposureComp;
	const float Expo = PresetExpo * FMath::Pow(2.f, EV);
	if (Expo == K.LastExpo) return;
	K.LastExpo = Expo;
	K.Film->SetScalarParameterValue(TEXT("Expo"), Expo);
}

void AValdradaClient::Meter(FCam& K, const FCaptureJob& J, const TArray<FColor>& Px)
{
	if (Px.Num() == 0) return;
	// the median luma of every 4th pixel, by a histogram
	uint32 Hist[256] = {};
	uint32 N = 0;
	for (int32 I = 0; I < Px.Num(); I += 4)
	{
		const FColor& C = Px[I];
		++Hist[FMath::Min(255, (54 * C.R + 183 * C.G + 19 * C.B) >> 8)];
		++N;
	}
	uint32 Acc = 0;
	int32 Med = 0;
	for (; Med < 255; ++Med) { Acc += Hist[Med]; if (Acc * 2 >= N) break; }
	const FExposureKey Key = KeyOf(TimeOfDay);
	const float M = FMath::Max(1.f, float(Med)) / 255.f;
	// (the sRGB curve is near a 2.2 power; AgX's mid-tones close to it: three quarters of the step, at most 2 EV a frame)
	const float Step = FMath::Clamp(0.75f * 2.2f * FMath::Log2(Key.Median / M), -2.f, 2.f);
	K.EV = FMath::Clamp(K.EV + Step, Key.MinEV, Key.MaxEV);
}
