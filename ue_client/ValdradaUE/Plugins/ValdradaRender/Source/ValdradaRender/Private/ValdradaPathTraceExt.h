// The path-traced captures as offline renders. Unreal restarts an interactive view's path tracing on any change in the
// scene (its invalidation counter, a Nanite ray-tracing structure rebuilt as streaming goes on), which in a moving city
// happens at every render, so a frame never reached its samples or its denoising. Marked offline, as Movie Render
// Queue marks its views, the accumulation restarts only when the client asks (the first render of each frame).
#pragma once

#include "CoreMinimal.h"
#include "SceneViewExtension.h"
#include "SceneView.h"

class FValdradaPathTraceExt : public FSceneViewExtensionBase
{
public:
	FValdradaPathTraceExt(const FAutoRegister& AutoRegister) : FSceneViewExtensionBase(AutoRegister) {}

	/** set before a frame's first path-traced render: that render starts the accumulation again */
	bool bResetNext = false;

	virtual void SetupViewFamily(FSceneViewFamily& InViewFamily) override {}
	virtual void SetupView(FSceneViewFamily& InViewFamily, FSceneView& InView) override
	{
		if (!InViewFamily.EngineShowFlags.PathTracing || !InView.bIsSceneCapture) return;
		InView.bIsOfflineRender = true;
		if (bResetNext) { InView.bForcePathTracerReset = true; bResetNext = false; }
	}
	virtual void BeginRenderViewFamily(FSceneViewFamily& InViewFamily) override {}
};
