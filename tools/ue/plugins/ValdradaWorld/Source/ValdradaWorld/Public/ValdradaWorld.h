// The persistent city level (docs/notes/ue-persistent-city.md): kit cells that stream with World Partition, the near/far
// swap (a far stand-in tagged vf+<key> is hidden while a near actor tagged vn+<key> is loaded and visible), and the
// editor helpers that set the level's runtime grids.
#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "Subsystems/WorldSubsystem.h"
#include "Kismet/BlueprintFunctionLibrary.h"
#include "LevelInstance/LevelInstanceActor.h"
#include "ValdradaWorld.generated.h"

class UInstancedStaticMeshComponent;
class ULevelStreamingDynamic;

/** a 128 m cell's kit instances from its table (tools/ue/vcel_write.py), built at BeginPlay; streamed by its bounds */
UCLASS()
class VALDRADAWORLD_API AValdradaStreamCell : public AActor
{
	GENERATED_BODY()
public:
	AValdradaStreamCell();

	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	FString TablePath;

	/** several tables merged (a block's cells): one instanced mesh component per mesh, materials and flags, not per cell */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	TArray<FString> TablePaths;

	/** false: the instances stay out of the ray tracing scene (the reduced far tables) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	bool bRayTracing = true;

	UFUNCTION(BlueprintCallable, Category = "Valdrada")
	void Clear();

	/** the cell's drawn extent (world space, cm): what World Partition streams it by (the actor stays at the origin) */
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	FBox StreamBounds = FBox(ForceInit);

	UFUNCTION(BlueprintCallable, Category = "Valdrada")
	int32 Build();

	UPROPERTY(VisibleAnywhere, BlueprintReadOnly, Category = "Valdrada")
	int32 BuiltInstances = 0;

	/** built since the last Clear (an empty table builds nothing but counts as built) */
	bool bBuilt = false;

#if WITH_EDITOR
	virtual void GetStreamingBounds(FBox& OutRuntimeBounds, FBox& OutEditorBounds) const override;
#endif

protected:
	virtual void BeginPlay() override;
	UPROPERTY(Transient)
	TArray<TObjectPtr<UInstancedStaticMeshComponent>> Made;
};

/** a block's or far package's level, streamed as a level when World Partition loads this actor; streamed by the bounds
    given here (a level instance's own bounds need its level loaded in the editor, which a commandlet never does) */
UCLASS()
class VALDRADAWORLD_API AValdradaLevelInstance : public ALevelInstance
{
	GENERATED_BODY()
public:
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	FBox StreamBounds = FBox(ForceInit);
#if WITH_EDITOR
	virtual void GetStreamingBounds(FBox& OutRuntimeBounds, FBox& OutEditorBounds) const override
	{
		Super::GetStreamingBounds(OutRuntimeBounds, OutEditorBounds);
		if (StreamBounds.IsValid) { OutRuntimeBounds = StreamBounds; OutEditorBounds = StreamBounds; }
	}
#endif
};

/** a block's or far package's level, loaded (as a level instance at its own coordinates) while World Partition has this
    actor loaded; the actor sits at its bounds' centre and streams by them (a level instance actor's descriptor takes its
    bounds from the level package, and the blocks' levels reach to the origin) */
UCLASS()
class VALDRADAWORLD_API AValdradaLevelStreamer : public AActor
{
	GENERATED_BODY()
public:
	AValdradaLevelStreamer();
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	TSoftObjectPtr<UWorld> Level;
	UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "Valdrada")
	FBox StreamBounds = FBox(ForceInit);
	bool IsReady() const;
	ULevel* GetLoadedLevel() const;
	/** a level loaded or unloaded by the swap (a far stand-in unloaded, not hidden, under a visible block); true when
	    this call changed what streaming should do */
	bool SetWanted(bool bWanted);
	/** the level loaded, not yet in the world: its components lose collision before they register (valdrada.LevelCollision 0) */
	UFUNCTION()
	void HandleLevelLoaded();
	void StartStreaming();
#if WITH_EDITOR
	virtual void GetStreamingBounds(FBox& OutRuntimeBounds, FBox& OutEditorBounds) const override;
#endif
protected:
	virtual void BeginPlay() override;
	virtual void EndPlay(const EEndPlayReason::Type Reason) override;
	UPROPERTY(Transient)
	TObjectPtr<ULevelStreamingDynamic> Streaming;
};

UCLASS()
class VALDRADAWORLD_API UValdradaSwapSubsystem : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UValdradaSwapSubsystem, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type T) const override { return T == EWorldType::Game || T == EWorldType::PIE; }
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual ETickableTickType GetTickableTickType() const override { return ETickableTickType::Always; }

	UPROPERTY(BlueprintReadOnly, Category = "Valdrada") int32 NearReady = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Valdrada") int32 FarHidden = 0;
	UPROPERTY(BlueprintReadOnly, Category = "Valdrada") int32 FarShown = 0;
private:
	TMap<TWeakObjectPtr<AActor>, TPair<TWeakObjectPtr<ULevel>, bool>> Applied;
	TSet<TWeakObjectPtr<ULevel>> FarRTDone;
	TMap<TWeakObjectPtr<ULevel>, bool> RTIn;
	/** per key: every far stand-in the swap wants for it is loaded and visible (last tick); a near block leaving the
	    range stays loaded until then, so no frame has neither */
	TMap<FName, bool> FarReadyPrev;
	/** per key: since when its near block is in range and not yet visible (its far stand-in is not loaded meanwhile) */
	TMap<FName, double> NearWaitSince;
	double LastLog = 0.0;
};

/** the shot server (valdrada.ShotServerDir): a game process that keeps the city level loaded and renders each shot
    asked for by a request file (<dir>/<name>.req: lines manifest=<Movie Render Queue manifest>) in the level as it
    stands, through the Movie Render Queue's in-world job; writes <name>.done (ok|failed, seconds) when it finishes */
UCLASS()
class VALDRADAWORLD_API UValdradaShotServer : public UTickableWorldSubsystem
{
	GENERATED_BODY()
public:
	virtual void Tick(float DeltaTime) override;
	virtual TStatId GetStatId() const override { RETURN_QUICK_DECLARE_CYCLE_STAT(UValdradaShotServer, STATGROUP_Tickables); }
	virtual bool DoesSupportWorldType(const EWorldType::Type T) const override { return T == EWorldType::Game; }
	virtual bool ShouldCreateSubsystem(UObject* Outer) const override;
	virtual ETickableTickType GetTickableTickType() const override { return ETickableTickType::Always; }
private:
	FString Current;
	double Started = 0.0, LastScan = 0.0;
	bool bWasRendering = false;
};

UCLASS()
class VALDRADAWORLD_API UValdradaWorldLib : public UBlueprintFunctionLibrary
{
	GENERATED_BODY()
public:
	/** editor: the World Partition level's runtime grids (spatial hash): names, cell sizes (cm), loading ranges (cm) */
	UFUNCTION(BlueprintCallable, Category = "Valdrada")
	static FString SetSpatialHashGrids(UWorld* World, const TArray<FName>& Names, const TArray<int32>& CellSizes, const TArray<float>& Ranges, bool bBlockOnSlowStreaming);

	/** editor: the runtime hash's class and grids, as text */
	UFUNCTION(BlueprintCallable, Category = "Valdrada")
	static FString DescribeRuntimeHash(UWorld* World);
};
