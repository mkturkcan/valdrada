// render.capture -> render.result. Each sensor group (the sensors that share a pose, fov and size) has its own scene
// captures, the RGB one keeping its rendering state between frames, so its temporal history (TSR, Lumen's caches, the
// exposure) converges as if it were the only camera; a camera that is new or has jumped renders WarmFramesOnCut engine
// frames before its image is read, others WarmFrames (Nanite's streaming and Lumen's caches follow frame by frame). The
// planes go back in the protocol's formats, rows top to bottom: rgba8, and depth_f32 in metres along the view axis with
// the camera's far distance for pixels with no geometry (depth_max). Instance segmentation and labels (segRender.js's codes
// and rows) come from an instance capture that draws only the road users' copies in M_client_id (ValdradaActors.cpp), its
// depth against the full scene's.
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
	J.Camera = *Cam;
	double Am = 0, Mp = 30;
	if (C->TryGetNumberField(TEXT("amodal"), Am)) J.Amodal = int32(Am);
	if (C->TryGetNumberField(TEXT("min_pixels"), Mp)) J.MinPixels = FMath::Max(1, int32(Mp));
	for (const FString& O : J.Outputs)
		if (O != TEXT("rgb") && O != TEXT("depth") && O != TEXT("albedo") && O != TEXT("normal") && !(O == TEXT("semantic") && SemanticMat)
			&& !((O == TEXT("instance") || O == TEXT("labels")) && IdMat))
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
		// (the road users' id copies are the instance capture's alone)
		for (UPrimitiveComponent* P : IdComponents) if (P) C->HideComponent(P);
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
	if (!K.Inst && (J.Outputs.Contains(TEXT("instance")) || J.Outputs.Contains(TEXT("labels"))))
	{
		// the road users' copies alone: their codes as unlit colour (scene colour, linear, unexposed) and their depth in alpha
		K.Inst = Make(SCS_SceneColorSceneDepth, PF_A32B32G32R32F, K.InstRT);
		K.Inst->HiddenComponents.Reset();   // (Make hides the copies from every capture: a hidden component outranks the show-only list)
		K.Inst->PrimitiveRenderMode = ESceneCapturePrimitiveRenderMode::PRM_UseShowOnlyList;
		for (UPrimitiveComponent* P : IdComponents) if (P) K.Inst->ShowOnlyComponent(P);
		K.Inst->ShowFlags.SetAntiAliasing(false);
		K.Inst->ShowFlags.SetTemporalAA(false);
		K.Inst->ShowFlags.SetAtmosphere(false);
		K.Inst->ShowFlags.SetFog(false);
		K.Inst->ShowFlags.SetVolumetricFog(false);
		K.Inst->ShowFlags.SetCloud(false);
		K.Inst->ShowFlags.SetBloom(false);
		K.Inst->ShowFlags.SetDynamicShadows(false);
		K.Inst->ShowFlags.SetGlobalIllumination(false);
		K.Inst->ShowFlags.SetTranslucency(false);
		K.Inst->ShowFlags.SetLumenGlobalIllumination(false);
		K.Inst->ShowFlags.SetLumenReflections(false);
		FPostProcessSettings& PS = K.Inst->PostProcessSettings;
		PS.bOverride_AutoExposureMethod = true; PS.AutoExposureMethod = EAutoExposureMethod::AEM_Manual;
		PS.bOverride_AutoExposureBias = true; PS.AutoExposureBias = 0.f;
		PS.bOverride_AutoExposureApplyPhysicalCameraExposure = true; PS.AutoExposureApplyPhysicalCameraExposure = false;
		K.Inst->PostProcessBlendWeight = 1.f;
	}
	// (semantic reads the depth too: the sky is where nothing is drawn; the instance pass compares it with its own)
	if (!K.Depth && (J.Outputs.Contains(TEXT("depth")) || J.Outputs.Contains(TEXT("semantic")) || J.Outputs.Contains(TEXT("instance")) || J.Outputs.Contains(TEXT("labels"))))
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
	for (USceneCaptureComponent2D* C : { K.Rgb.Get(), K.Depth.Get(), K.Sem.Get(), K.Alb.Get(), K.Nrm.Get(), K.Inst.Get() })
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
	// the depth once (the depth output, the semantic sky and the instance pass read it)
	const bool bIds = J.Outputs.Contains(TEXT("instance")) || J.Outputs.Contains(TEXT("labels"));
	TArray<float> Depth, SceneM;
	if (K.Depth && (J.Outputs.Contains(TEXT("depth")) || J.Outputs.Contains(TEXT("semantic")) || bIds))
	{
		const double T = FPlatformTime::Seconds();
		K.Depth->CaptureScene();
		TArray<FLinearColor> Px;
		FTextureRenderTargetResource* R = K.DepthRT->GameThread_GetRenderTargetResource();
		if (!R || !R->ReadLinearColorPixels(Px) || Px.Num() != NPx) { Fail(J, TEXT("internal"), TEXT("depth read back failed")); return; }
		Depth.SetNumUninitialized(NPx);
		if (bIds) SceneM.SetNumUninitialized(NPx);
		const float Max = float(DepthMax);
		for (int64 I = 0; I < NPx; ++I)
		{
			const float M = Px[I].R * 0.01f;   // scene depth: centimetres along the view axis
			const bool bHit = FMath::IsFinite(M) && M > 0.f;
			Depth[I] = (bHit && M < Max) ? M : Max;
			if (bIds) SceneM[I] = bHit ? M : TNumericLimits<float>::Max();
		}
		Timing->SetNumberField(TEXT("depth_ms"), (FPlatformTime::Seconds() - T) * 1000.0);
	}
	// the instance plane and the labels once (the instance output and the labels both read them)
	TArray<uint8> InstPlane;
	TSharedPtr<FJsonObject> Labels;
	if (bIds && K.Inst)
	{
		if (!InstancesAndLabels(K, J, SceneM, J.Outputs.Contains(TEXT("instance")) ? &InstPlane : nullptr, Labels, Timing))
		{
			Fail(J, TEXT("internal"), TEXT("instance read back failed"));
			return;
		}
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
		else if (O == TEXT("instance") && InstPlane.Num() == NPx * 4)
		{
			Out = MoveTemp(InstPlane);
		}
		else if (O == TEXT("labels"))
		{
			Planes.Pop();   // (labels travel in the params, no blob)
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
	if (Labels.IsValid()) P->SetObjectField(TEXT("labels"), Labels.ToSharedRef());
	else P->SetField(TEXT("labels"), MakeShared<FJsonValueNull>());
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

// The instance plane and the labels (segRender.js capture, steps 1 to 3): the instance capture draws the road users' copies
// alone, each its code as colour and its depth in alpha; a copy's pixel is the road user the camera sees where its depth is
// not behind the full scene's, so the plane holds the visible codes and each label row its visible box and area. The copy's
// own pixels, the road user among the road users alone, are its amodal box (occlusion by other road users is not counted).
bool AValdradaClient::InstancesAndLabels(FCam& K, const FCaptureJob& J, const TArray<float>& SceneM, TArray<uint8>* Plane, TSharedPtr<FJsonObject>& Labels, TSharedRef<FJsonObject> Timing)
{
	const double T0 = FPlatformTime::Seconds();
	const int32 W = J.Width, H = J.Height;
	const int64 NPx = int64(W) * H;
	K.Inst->CaptureScene();
	TArray<FLinearColor> Px;
	FTextureRenderTargetResource* R = K.InstRT->GameThread_GetRenderTargetResource();
	if (!R || !R->ReadLinearColorPixels(Px) || Px.Num() != NPx) return false;
	struct FSt
	{
		int32 X0 = MAX_int32, Y0 = MAX_int32, X1 = -1, Y1 = -1;
		int64 N = 0;
		void Add(int32 X, int32 Y) { X0 = FMath::Min(X0, X); Y0 = FMath::Min(Y0, Y); X1 = FMath::Max(X1, X); Y1 = FMath::Max(Y1, Y); ++N; }
	};
	TMap<uint32, FSt> Vis, All;
	if (Plane) Plane->SetNumZeroed(NPx * 4);
	int64 Coded = 0, Unknown = 0, Visible = 0, Drawn = 0;
	FLinearColor MaxC(0, 0, 0, 0);
	double SumDid = 0, SumDs = 0;
	uint32 LastCode = 0;
	FSt* LastVis = nullptr;
	FSt* LastAll = nullptr;
	auto Byte = [](float V) { return uint32(FMath::Clamp(FMath::RoundToInt(V * 255.f), 0, 255)); };
	for (int32 Y = 0; Y < H; ++Y)
		for (int32 X = 0; X < W; ++X)
		{
			const int64 I = int64(Y) * W + X;
			const FLinearColor& C = Px[I];
			if (C.A > 0.f && C.A < 1e6f) { ++Drawn; MaxC.R = FMath::Max(MaxC.R, C.R); MaxC.G = FMath::Max(MaxC.G, C.G); MaxC.B = FMath::Max(MaxC.B, C.B); }
			const uint32 R8 = Byte(C.R), G8 = Byte(C.G), B8 = Byte(C.B);
			const uint32 Code = R8 | (G8 << 8) | (B8 << 16);
			if (Code == 0) continue;
			++Coded;
			if (Code != LastCode)
			{
				if (!ThingOfCode.Contains(Code)) { ++Unknown; continue; }
				LastCode = Code; LastVis = &Vis.FindOrAdd(Code); LastAll = &All.FindOrAdd(Code);
				// (a map that grew may have moved the other entry)
				LastVis = Vis.Find(Code); LastAll = All.Find(Code);
			}
			LastAll->Add(X, Y);
			const float Did = C.A * 0.01f, Ds = SceneM.IsValidIndex(I) ? SceneM[I] : TNumericLimits<float>::Max();
			if (Ds < 1e6f) { SumDid += Did; SumDs += Ds; }
			if (Did <= Ds + FMath::Max(0.03f, 0.003f * Ds))
			{
				++Visible;
				LastVis->Add(X, Y);
				if (Plane) { uint8* D = Plane->GetData() + I * 4; D[0] = uint8(R8); D[1] = uint8(G8); D[2] = uint8(B8); D[3] = 255; }
			}
		}
	// the rows (segRender.js: visible things of min_pixels or more, the largest first)
	struct FRow { uint32 Code; const FSt* V; };
	TArray<FRow> Rows;
	for (const TPair<uint32, FSt>& KV : Vis) if (KV.Value.N >= J.MinPixels) Rows.Add({ KV.Key, &KV.Value });
	Rows.Sort([](const FRow& A, const FRow& B) { return A.V->N > B.V->N; });
	auto Arr = [](std::initializer_list<double> L) { TArray<TSharedPtr<FJsonValue>> A; for (double V : L) A.Add(MakeShared<FJsonValueNumber>(V)); return A; };
	auto Round = [](double V, double Q) { return FMath::RoundToDouble(V * Q) / Q; };
	TArray<TSharedPtr<FJsonValue>> Inst;
	for (const FRow& Rw : Rows)
	{
		const FThing& T = Things[ThingOfCode[Rw.Code]];
		const FSt& V = *Rw.V;
		TSharedRef<FJsonObject> O = MakeShared<FJsonObject>();
		O->SetNumberField(TEXT("id"), T.Label);
		O->SetNumberField(TEXT("code"), Rw.Code);
		O->SetNumberField(TEXT("class_id"), T.Cls);
		const FString* Name = ClassNames.Find(T.Cls);
		O->SetStringField(TEXT("class"), Name ? *Name : FString());
		O->SetStringField(TEXT("key"), T.Key);
		O->SetArrayField(TEXT("bbox"), Arr({ double(V.X0), double(V.Y0), double(V.X1 - V.X0 + 1), double(V.Y1 - V.Y0 + 1) }));
		O->SetNumberField(TEXT("area"), double(V.N));
		O->SetBoolField(TEXT("truncated"), V.X0 <= 0 || V.Y0 <= 0 || V.X1 >= W - 1 || V.Y1 >= H - 1);
		if (J.Amodal > 0)
		{
			const FSt* A = All.Find(Rw.Code);
			if (!A || A->N <= V.N)
			{
				O->SetArrayField(TEXT("amodal_bbox"), O->GetArrayField(TEXT("bbox")));
				O->SetNumberField(TEXT("amodal_area"), double(V.N));
				O->SetNumberField(TEXT("occlusion"), 0.0);
			}
			else
			{
				O->SetArrayField(TEXT("amodal_bbox"), Arr({ double(A->X0), double(A->Y0), double(A->X1 - A->X0 + 1), double(A->Y1 - A->Y0 + 1) }));
				O->SetNumberField(TEXT("amodal_area"), double(A->N));
				O->SetNumberField(TEXT("occlusion"), Round(1.0 - double(V.N) / double(A->N), 1e4));
			}
		}
		TSharedRef<FJsonObject> Pose = MakeShared<FJsonObject>();
		Pose->SetArrayField(TEXT("pos"), Arr({ Round(T.P[0], 100), Round(T.P[1], 100), Round(T.P[2], 100) }));
		Pose->SetNumberField(TEXT("yaw"), Round(T.Yaw, 1000));
		Pose->SetArrayField(TEXT("dims"), Arr({ T.Dims.X, T.Dims.Y, T.Dims.Z }));
		Pose->SetNumberField(TEXT("speed_mps"), Round(T.Speed, 100));
		Pose->SetBoolField(TEXT("moving"), T.bMoving);
		if (!T.Kind.IsEmpty()) Pose->SetStringField(TEXT("kind"), T.Kind);
		O->SetObjectField(TEXT("pose"), Pose);
		Inst.Add(MakeShared<FJsonValueObject>(O));
	}
	// the camera block (segRender.js cameraBlock) from the request's camera, in the core's frame
	TSharedRef<FJsonObject> Cam = MakeShared<FJsonObject>();
	double P[3] = { 0, 0, 0 }, Q[4] = { 0, 0, 0, 1 }, Fov = 58.7, Near = 0.4, Far = J.Far;
	Valdrada::Num3(J.Camera, TEXT("pos"), P, 3);
	Valdrada::Num3(J.Camera, TEXT("quat"), Q, 4);
	if (J.Camera.IsValid()) { J.Camera->TryGetNumberField(TEXT("fov_y_deg"), Fov); J.Camera->TryGetNumberField(TEXT("near"), Near); J.Camera->TryGetNumberField(TEXT("far"), Far); }
	{
		const double x = Q[0], y = Q[1], z = Q[2], w = Q[3];
		const double m11 = 1 - 2 * (y * y + z * z), m13 = 2 * (x * z + w * y), m21 = 2 * (x * y + w * z), m22 = 1 - 2 * (x * x + z * z);
		const double m23 = 2 * (y * z - w * x), m31 = 2 * (x * z - w * y), m33 = 1 - 2 * (x * x + y * y);
		// (three.js Euler 'YXZ')
		const double Pitch = FMath::Asin(-FMath::Clamp(m23, -1.0, 1.0));
		const bool bOk = FMath::Abs(m23) < 0.9999999;
		const double Yaw = bOk ? FMath::Atan2(m13, m33) : FMath::Atan2(-m31, m11), Roll = bOk ? FMath::Atan2(m21, m22) : 0.0;
		const double Fy = H / (2.0 * FMath::Tan(FMath::DegreesToRadians(Fov) * 0.5));
		Cam->SetArrayField(TEXT("pos"), Arr({ Round(P[0], 1000), Round(P[1], 1000), Round(P[2], 1000) }));
		Cam->SetArrayField(TEXT("quat"), Arr({ Round(x, 1e6), Round(y, 1e6), Round(z, 1e6), Round(w, 1e6) }));
		Cam->SetNumberField(TEXT("yaw"), Round(Yaw, 1e5));
		Cam->SetNumberField(TEXT("pitch"), Round(Pitch, 1e5));
		Cam->SetNumberField(TEXT("roll"), Round(Roll, 1e5));
		Cam->SetNumberField(TEXT("fov_y_deg"), Fov);
		Cam->SetNumberField(TEXT("aspect"), Round(double(W) / double(H), 1e6));
		Cam->SetNumberField(TEXT("near"), Near);
		Cam->SetNumberField(TEXT("far"), Far);
		TArray<TSharedPtr<FJsonValue>> Km = {
			MakeShared<FJsonValueArray>(Arr({ Round(Fy, 1000), 0.0, W / 2.0 })), MakeShared<FJsonValueArray>(Arr({ 0.0, Round(Fy, 1000), H / 2.0 })),
			MakeShared<FJsonValueArray>(Arr({ 0.0, 0.0, 1.0 })) };
		Cam->SetArrayField(TEXT("K"), Km);
		// (shared/geo.js unproject)
		const double MLat = 111132.0, MLon = 111320.0 * FMath::Cos(FMath::DegreesToRadians(40.7831));
		Cam->SetArrayField(TEXT("lonlat"), Arr({ Round(P[0] / MLon - 73.9712, 1e7), Round(-P[2] / MLat + 40.7831, 1e7) }));
	}
	Labels = MakeShared<FJsonObject>();
	Labels->SetNumberField(TEXT("frame"), double(J.Frame));
	Labels->SetObjectField(TEXT("camera"), Cam);
	Labels->SetArrayField(TEXT("instances"), Inst);
	Labels->SetArrayField(TEXT("classes"), HelloClasses);
	TSharedRef<FJsonObject> Enc = MakeShared<FJsonObject>();
	Enc->SetNumberField(TEXT("mul"), 3635641); Enc->SetNumberField(TEXT("inv"), 5029001); Enc->SetNumberField(TEXT("mod"), 16777216);
	Labels->SetObjectField(TEXT("instance_encoding"), Enc);
	TSharedRef<FJsonObject> Counts = MakeShared<FJsonObject>();
	Counts->SetNumberField(TEXT("instances"), Inst.Num());
	Counts->SetNumberField(TEXT("unlabeled_id_px"), double(Unknown));
	Labels->SetObjectField(TEXT("counts"), Counts);
	Timing->SetNumberField(TEXT("instance_ms"), (FPlatformTime::Seconds() - T0) * 1000.0);
	// (the pass's own account, once a minute: road users drawn, coded and visible pixels, the copies' and the scene's depth)
	static double LastDiag = 0;
	if (FPlatformTime::Seconds() - LastDiag > 60.0)
	{
		LastDiag = FPlatformTime::Seconds();
		Note(FString::Printf(TEXT("instance pass %d: %d road users, %d id copies, %lld px drawn (max colour %.4f %.4f %.4f), %lld coded px (%lld unknown), %lld visible, %d rows; mean depth copies %.2f m, scene %.2f m"),
			J.Id, Things.Num(), IdComponents.Num(), Drawn, MaxC.R, MaxC.G, MaxC.B, Coded, Unknown, Visible, Inst.Num(), Coded ? SumDid / FMath::Max<int64>(1, Coded - Unknown) : 0.0, Coded ? SumDs / FMath::Max<int64>(1, Coded - Unknown) : 0.0));
	}
	Timing->SetNumberField(TEXT("instance_px"), double(Coded));
	if (Unknown > 0) Timing->SetNumberField(TEXT("instance_unknown_px"), double(Unknown));
	// (codes that match no road user mean the copies' colour did not come back exact: say so, loudly, once a minute)
	if (Coded > 0 && Unknown * 50 > Coded && FPlatformTime::Seconds() - LastWarn > 60.0)
	{
		LastWarn = FPlatformTime::Seconds();
		Note(FString::Printf(TEXT("capture %d: %lld of %lld instance pixels carry a code no road user has"), J.Id, Unknown, Coded));
	}
	return true;
}
