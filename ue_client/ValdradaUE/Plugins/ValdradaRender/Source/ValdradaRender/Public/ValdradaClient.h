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
	/** the tier's console variables from Data/tiers.json (the persistent city's graphics tiers, tools/ue/persist_tiers.json) */
	void ApplyTier();
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
	struct FStatic { FString Type; int32 Kind = -1; FTransform Xf; float Skin = -1.f; };
	TMap<int32, FStatic> Statics;          // id -> what the add said (parked vehicles carry their pose)
	TArray<FString> KindNames;             // hello vehicle_kinds
	TArray<FVector3f> KindSizes;           // [w, h, l] m per kind
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> KindISM;   // per kind: moving and parked vehicles
	UPROPERTY() TArray<TObjectPtr<UStaticMesh>> KindMesh;
	TArray<bool> KindIsBox;
	TArray<bool> KindTaxiPaint;
	// an actor keeps its instance slot while it is drawn, so the renderer's motion vectors (TSR, motion blur) follow it;
	// a freed slot is parked at zero scale for the next actor
	struct FSlots { TMap<int32, int32> Slot; TArray<int32> Free; TMap<int32, uint8> Lamps; };
	TArray<FSlots> KindSlots;
	FSlots WalkerSlots, TrainSlots;
	// the kinds' wheels (Data/fleet.json, Tools/make_fleet.py): each its own mesh centred on its hub, turned by the record's
	// spin about the axle and the front pair steered (fleet24.js f24Wheel); one instanced mesh per kind and wheel
	struct FWheel
	{
		UStaticMesh* Mesh = nullptr;
		FVector3f Hub = FVector3f::ZeroVector;   // the hub in the model's frame (metres: x left, y up, z forward)
		bool bFront = false;
		UInstancedStaticMeshComponent* ISM = nullptr;
		UInstancedStaticMeshComponent* IdISM = nullptr;
		FSlots Slots;
	};
	TArray<TArray<FWheel>> KindWheels;
	TSharedPtr<FJsonObject> FleetTable;
	// the train cars (Data/trains.json, Tools/make_trains.py): per kind of the hello's train_kinds its mesh, one instanced
	// mesh each; a kind without a mesh draws boxes of the car's size
	TArray<FString> TrainKinds;
	TArray<UStaticMesh*> TrainMesh;
	TArray<UInstancedStaticMeshComponent*> TrainKindISM;
	TArray<FSlots> TrainKindSlots;
	void SetupTrains(const TArray<TSharedPtr<class FJsonValue>>& Kinds);
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> WalkerISM;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> TrainISM;
	void SetupKinds(const TArray<TSharedPtr<class FJsonValue>>& Kinds);
	// a kind's instanced meshes (the body with its glass, lamps and paint, its wheels, their id copies), made once
	void EnsureKindISM(int32 K);
	void OnState(FValdradaMessage& M);

	// ---- instance segmentation and labels (segRender.js's codes): every road user drawn has a copy seen only by the
	// instance capture, in M_client_id (unlit, its 24-bit code as colour); the capture's depth against the full scene's
	// keeps the pixels where the road user is what the camera sees, the copy's own pixels are its silhouette among the road
	// users alone (amodal)
	struct FThing
	{
		int32 Id = 0;          // the core's id (API actors keep theirs; the recorder's start at 1,000,000)
		int32 Label = 0;       // the label id (stable per key for the session, as segRender.js newId)
		uint32 Code = 0;       // (Label x 3635641) mod 2^24
		uint8 Cls = 0;         // its semantic class
		FString Key;           // veh:<kind>:api<id> / ped:api<id> for API actors (bridge.js labelActor), the core's id otherwise
		float P[3] = { 0, 0, 0 };   // the body's origin in the core's frame (metres, x east, y up, z south)
		float Yaw = 0;         // heading about +y, 0 facing +z
		FVector3f Dims = FVector3f(1.9f, 1.5f, 4.6f);   // [w, h, l] m
		FString Kind;          // the vehicle kind, the walker's variant or the train's
		float Speed = 0;
		bool bMoving = false;
	};
	TArray<FThing> Things;                 // this state's road users
	TMap<uint32, int32> ThingOfCode;       // code -> index in Things
	TMap<FString, int32> LabelIds;
	int32 NextLabel = 1;
	uint32 CodeFor(const FString& Key);
	UPROPERTY() TObjectPtr<class UMaterialInterface> IdMat;
	UPROPERTY() TObjectPtr<class UMaterialInterface> GlassMat;   // the fleet's windows (M_client_glass)
	UPROPERTY() TObjectPtr<class UMaterialInterface> LampMat;    // the fleet's lamps and sirens (M_client_lamp)
	UPROPERTY() TArray<TObjectPtr<UInstancedStaticMeshComponent>> KindIdISM;   // per kind: the vehicles' copies
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> WalkerIdISM;
	UPROPERTY() TObjectPtr<UInstancedStaticMeshComponent> TrainIdISM;
	UPROPERTY() TArray<TObjectPtr<class UPrimitiveComponent>> IdComponents;   // every copy, for the captures' lists
	UInstancedStaticMeshComponent* MakeIdISM(UStaticMesh* Mesh);

	// ---- the crowd's photoreal walkers (Data/crowd.json from Tools/make_crowd.py): per walker a skeletal body of its variant
	// playing its walk, run or idle clip at the web crowd's rate (crowd.js), and an id copy following its pose; without the
	// table the walkers are capsules
	struct FCrowdVariant
	{
		FString Name, Gender;
		class USkeletalMesh* Mesh = nullptr;
		TArray<TPair<FName, class UMaterialInterface*>> Slots;
		class UAnimSequence* Anim[3] = { nullptr, nullptr, nullptr };   // idle, walk, run
		float Seconds[3] = { 1, 1, 1 };
		float Speed[3] = { 0, 1, 1 };    // the clip's natural speed, m/s
		float Scale = 1.f, Height = 1.8f, Hips = 1.f, RefHips = 1.f;
		bool bChild = false;
	};
	TArray<FCrowdVariant> Crowd;
	struct FWalkerBody
	{
		class USkeletalMeshComponent* Body = nullptr;
		class USkeletalMeshComponent* Id = nullptr;
		class UMaterialInstanceDynamic* IdMid = nullptr;
		int32 Variant = -1, Clip = -1;
		double T = 0;
		uint32 Code = 0;
	};
	TMap<int32, FWalkerBody> WalkerBodies;
	TArray<FWalkerBody> FreeBodies;
	FWalkerBody NewWalkerBody();   // a walker's body and its id copy, registered
	void LoadCrowd();
	struct FWalkerRec { int32 Id; float P[3]; float Yaw, V, Phase, Sxz, Sy; uint8 Amp, Pose; uint32 Code; };
	void DrawWalkerBodies(const TArray<FWalkerRec>& Recs, float Dt);
	void AddIdComponent(class UPrimitiveComponent* C);
	TArray<TSharedPtr<class FJsonValue>> HelloClasses;   // the core's class table (map.get_semantic_classes)
	TMap<int32, FString> ClassNames;

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
		int32 Amodal = 0;              // the group's amodal attribute: > 0 measures each road user's full box and occlusion
		int32 MinPixels = 30;          // labels for road users with at least this many visible pixels
		TSharedPtr<FJsonObject> Camera;   // the request's camera (the core's frame), for the labels' camera block
	};
	TArray<FCaptureJob> Captures;
	struct FCam
	{
		TObjectPtr<USceneCaptureComponent2D> Rgb, Depth, Sem, Alb, Nrm, Inst;
		TObjectPtr<UTextureRenderTarget2D> RgbRT, DepthRT, SemRT, AlbRT, NrmRT, InstRT;
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
	/** the instance plane and the labels from the instance capture and the full scene's depth (metres, +inf where nothing is drawn) */
	bool InstancesAndLabels(FCam& K, const FCaptureJob& J, const TArray<float>& SceneDepthM, TArray<uint8>* Plane, TSharedPtr<FJsonObject>& Labels, TSharedRef<FJsonObject> Timing);
	void Meter(FCam& K, const FCaptureJob& J, const TArray<FColor>& Px);

	double LastWarn = 0;
	int64 StatesSeen = 0;
};
