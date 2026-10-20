// The renderer client of the headless core (docs/specs/render-protocol.md, valdrada.render/0), one actor in the client's
// map: it connects to the core, says render.hello, streams the city's levels and cell tables for each render.load,
// draws each render.state (the time of day, the view, the road users of its ATRK frame block) and answers each
// render.capture with the requested planes (render.result).
//
// Frames: the core's (the tiles') is metres, x east, y up, z south; Unreal's is centimetres, X east, Y south, Z up:
// location (x, z, y) x 100, a rotation quaternion (-qx, -qz, -qy, qw) (tools/core/read_tracks.py to_ue, ue_light.py ue_pos).
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "ValdradaClient.generated.h"

class FValdradaLink;
struct FValdradaMessage;
class FJsonObject;
class ADirectionalLight;
class ASkyLight;
class ASkyAtmosphere;
class AVolumetricCloud;
class APostProcessVolume;
class ACameraActor;
class UMaterialInstanceDynamic;
class UMaterialParameterCollection;
class ULevelStreamingDynamic;
class AValdradaCell;
class USceneCaptureComponent2D;
class UTextureRenderTarget2D;
class UInstancedStaticMeshComponent;
class UStaticMesh;

UCLASS(Config = Game)
class VALDRADARENDER_API AValdradaClient : public AActor
{
	GENERATED_BODY()

public:
	AValdradaClient();

	/** the core (command line -ValdradaHost= -ValdradaPort=) */
	UPROPERTY(Config) FString Host = TEXT("127.0.0.1");
	UPROPERTY(Config) int32 Port = 2000;
	/** the streaming tier the hello asks for: low, medium, high, cinematic (-ValdradaTier=) */
	UPROPERTY(Config) FString Tier = TEXT("high");
	/** where the cells' kit tables (<key>.vcel) are, absolute or relative to the project (-ValdradaTables=) */
	UPROPERTY(Config) FString TablesDir = TEXT("Data/tables");
	/** engine frames a capture camera renders before its image is read: on its first use or after a cut, and otherwise */
	UPROPERTY(Config) int32 WarmFramesOnCut = 16;
	UPROPERTY(Config) int32 WarmFrames = 1;
	/** depth beyond this many metres, and the sky, read as this value (depth_max; the three.js renderer's 1000 m) */
	UPROPERTY(Config) float DepthMaxM = 1000.f;
	/** cell tables assembled per frame while a load streams in */
	UPROPERTY(Config) int32 CellBuildsPerFrame = 6;
	/** the road users' region is the core's; parked and moving vehicles drawn from /Game/Client/Fleet/<kind>/SM_<kind> when present */
	UPROPERTY(Config) FString FleetPath = TEXT("/Game/Client/Fleet");
	/** while no capture waits, a load set is brought in at once: the level streaming flushed and every queued cell table
	 *  built in one frame (time-sliced, the 0.5.0 package took 180 s for the first 732 levels and left levels pending for
	 *  minutes after a move). No garbage collection is forced after levels leave: in the cooked build a forced full
	 *  purge, deferred until the loads finished, left the game thread spinning (the 0.5.0 smoke test's hang). */
	UPROPERTY(Config) bool bFlushLoads = true;
	/** on quit: pending captures answered with an error, the link closed, the process ended without the world's teardown
	 *  (minutes with a city of a thousand levels) */
	UPROPERTY(Config) bool bFastExit = true;
	/** the semantic output (custom stencil through /Game/Client/Materials/M_client_semantic) */
	UPROPERTY(Config) bool bSemantic = true;

	/** a line in Saved/Logs/ValdradaRender.log (written in every build configuration, Shipping included) and the log */
	static void Note(const FString& Line);

	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	virtual void Tick(float DeltaSeconds) override;

private:
	// ---- the link
	TUniquePtr<FValdradaLink> Link;
	TUniquePtr<class FValdradaExitWatch> ExitWatch;
	TSharedPtr<class FValdradaPathTraceExt, ESPMode::ThreadSafe> PathTraceExt;
	int32 NextId = 1;
	bool bHelloSent = false;
	bool bNoView = false;   // -ValdradaNoView: the offscreen window draws no world (captures only)
	void SendHello();
	void Dispatch(FValdradaMessage& M);
	int32 SendRequest(const FString& Method, const TSharedRef<FJsonObject>& Params, const TArray<TArrayView<const uint8>>& Blobs = TArray<TArrayView<const uint8>>());

	// ---- environment (ue_light.py's physical rig: sun, sky atmosphere, clouds, captured sky light, the film look)
	UPROPERTY() TObjectPtr<ADirectionalLight> Sun;
	UPROPERTY() TObjectPtr<ADirectionalLight> Moon;
	UPROPERTY() TObjectPtr<ASkyLight> SkyLight;
	UPROPERTY() TObjectPtr<ASkyAtmosphere> Atmosphere;
	UPROPERTY() TObjectPtr<AVolumetricCloud> Clouds;
	UPROPERTY() TObjectPtr<class AExponentialHeightFog> Fog;
	UPROPERTY() TObjectPtr<APostProcessVolume> Film;
	UPROPERTY() TObjectPtr<UMaterialInstanceDynamic> FilmMID;
	UPROPERTY() TObjectPtr<UMaterialParameterCollection> NightMPC;
	FString TimeOfDay;
	float NightValue = -1.f;
	float PresetExpo = 1.f;   // the time of day's fixed exposure (the film look's Expo)
	void SetupEnvironment();
	void ApplyEnv(const TSharedPtr<FJsonObject>& Env);
	void ApplyEnvLook(const TSharedPtr<FJsonObject>& Env, bool bForce);
	FString LastLook, LastLookTod;

	// ---- the view (the server window's camera: the primary sensor, else the spectator)
	UPROPERTY() TObjectPtr<ACameraActor> ViewCam;
	void ApplyView(const TSharedPtr<FJsonObject>& View);

	// ---- streaming (Data/city.json from Tools/make_manifests.py)
	struct FCity
	{
		bool bOk = false;
		double Cell = 128, Block = 1024;
		TMap<FIntPoint, FString> Blocks;       // 1 km block -> its level (/Game/CCB/<key>/L)
		TMap<FIntPoint, int32> CityBlocks;     // 1 km block -> the city's cells in it
		TMap<FString, FString> CellTables;     // cell -> its table key
		TMap<FIntPoint, TArray<FString>> CellsOfBlock;
		TMap<FString, FString> Far;            // far package -> its level (/Game/CF/<key>/L)
		TSet<FString> Chunks;                  // the far chunks' keys (L<n>_<i>_<j>)
		struct FLandmark { FString Key; FVector3d Lo, Hi; bool bBridge = false; };
		TArray<FLandmark> Landmarks;
	} City;
	void LoadCity();
	FIntPoint BlockOf(const FString& CellKey) const;
	FIntPoint BlockAt(double X, double Z) const;

	UPROPERTY() TMap<FString, TObjectPtr<ULevelStreamingDynamic>> Levels;   // level path -> its streaming instance
	// semantic classes (Data/classes.json): per block level its meshes' (g<n>) and instance sets' (s<n>) class ids; a far
	// level's class by its package's kind; drawn as each component's custom stencil
	TMap<FString, TMap<FString, uint8>> LevelClasses;
	TMap<FString, uint8> LevelDefault;
	TSet<FString> Labelled;
	void LabelLevel(const FString& Path, class ULevel* Level);
	// a streamed level's components lose their collision before they are added to the world: the renderer queries no
	// physics, and the cooked build spent minutes in Chaos removing the bodies of a block that left (each removal
	// reallocating the pending spatial queue), the 0.5.0 smoke test's hang
	UFUNCTION() void OnStreamedLevelLoaded();
	TSet<FString> CollisionOff;
	static void LabelComponent(class UPrimitiveComponent* C, int32 Cls);
	UPROPERTY() TObjectPtr<class UMaterialInterface> SemanticMat;
	UPROPERTY() TMap<FString, TObjectPtr<AValdradaCell>> CellActors;         // cell -> its table's actor
	TArray<FString> CellQueue;                                             // cells waiting for their table to be built
	int64 LoadFrame = -1;
	double LoadT0 = 0;
	int64 LoadSeq = -1;
	int32 LastPending = -1;
	double LastLoadedSent = 0;
	TSharedPtr<FJsonObject> LastLoad;
	void OnLoad(const TSharedPtr<FJsonObject>& L);
	void StepStreaming();
	int32 PendingCount(int32* OutLevels = nullptr, int32* OutCells = nullptr, int32* OutShaders = nullptr) const;
	void ReportLoaded(bool bForce);

	// ---- road users (render.state: actors.add / remove and the ATRK frame block)
	struct FStatic { FString Type; int32 Kind = -1; FTransform Xf; };
	TMap<int32, FStatic> Statics;          // id -> what the add said (parked vehicles carry their pose)
	TArray<FString> KindNames;             // hello vehicle_kinds
	TArray<FVector3f> KindSizes;           // [w, h, l] m per kind
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> KindISM;   // per kind: moving and parked vehicles
	UPROPERTY() TArray<TObjectPtr<UStaticMesh>> KindMesh;
	TArray<bool> KindIsBox;
	TArray<bool> KindTaxiPaint;
	// an actor keeps its instance slot while it is drawn, so the renderer's motion vectors (TSR, motion blur) follow it;
	// a freed slot is parked at zero scale for the next actor
	struct FSlots { TMap<int32, int32> Slot; TArray<int32> Free; };
	TArray<FSlots> KindSlots;
	FSlots WalkerSlots, TrainSlots;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> WalkerISM;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> TrainISM;
	void SetupKinds(const TArray<TSharedPtr<class FJsonValue>>& Kinds);
	void OnState(FValdradaMessage& M);

	// ---- captures
	struct FCaptureJob
	{
		TSharedPtr<FJsonObject> Req;
		int32 Id = 0;
		int64 Frame = 0;
		int32 Width = 0, Height = 0;
		TArray<FString> Outputs;
		FTransform Pose;
		float HFovDeg = 90.f;
		double Far = 20000.0;
		int32 WarmLeft = 0;
		double T0 = 0;
		FString Key;
		bool bAutoExposure = true;   // the sensor's exposure_mode
		float ExposureComp = 0.f;    // its exposure_compensation, EV
		bool bCut = false;
		FString Mode = TEXT("lumen");  // the request's capture mode: lumen, or pathtrace (Unreal's path tracer, Spp samples)
		int32 Spp = 1;
		bool bBurst = false;           // its warm frames in one engine tick (a replay: the state does not change between them)
		bool bDenoise = true;          // the path tracer's denoiser on the last sample
		double TRender = 0;            // its first render submitted (timing)
		int32 Renders = 0;
	};
	TArray<FCaptureJob> Captures;
	struct FCam
	{
		TObjectPtr<USceneCaptureComponent2D> Rgb, Depth, Sem, Alb, Nrm;
		TObjectPtr<UTextureRenderTarget2D> RgbRT, DepthRT, SemRT, AlbRT, NrmRT;
		FTransform Last;
		bool bUsed = false;
		TObjectPtr<UMaterialInstanceDynamic> Film;   // this camera's film look (its own exposure)
		float EV = 0.f;                              // its metered exposure over the time of day's, EV
		float LastExpo = -1.f;                       // the film's Expo as last set (a path tracer restarts on a change)
	};
	TMap<FString, FCam> Cams;
	UPROPERTY() TArray<TObjectPtr<UObject>> KeepAlive;
	void OnCapture(const TSharedPtr<FJsonObject>& C);
	void StepCaptures();
	FCam& CamFor(const FCaptureJob& J);
	void Finish(FCaptureJob& J);
	void Fail(const FCaptureJob& J, const FString& Code, const FString& Message);
	void ApplyExposure(FCam& K, const FCaptureJob& J);
	void Meter(FCam& K, const FCaptureJob& J, const TArray<FColor>& Px);

	double LastWarn = 0;
	int64 StatesSeen = 0;
};
