#include "ValdradaCell.h"
#include "Engine/CollisionProfile.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Components/SceneComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInterface.h"
#include "HAL/PlatformTime.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"

DEFINE_LOG_CATEGORY_STATIC(LogValdradaCell, Log, All);

// The table (little endian; tools/ue/vcel_write.py): 'VCEL', u32 version 1, u32 sets; per set: str mesh path, u16
// materials and a str path each ('' keeps the mesh's own), u32 flags (bit 0 casts shadow), u32 custom floats per
// instance, u32 instances, then per instance twelve f32 (its X, Y and Z axes, scaled, and its location, in Unreal's
// axes and centimetres: the rows of its matrix), then the custom floats of every instance. A str is a u16 byte count and
// UTF-8.
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

AValdradaCell::AValdradaCell()
{
	PrimaryActorTick.bCanEverTick = false;
	RootComponent = CreateDefaultSubobject<USceneComponent>(TEXT("Root"));
	RootComponent->SetMobility(EComponentMobility::Static);
}

void AValdradaCell::BeginPlay()
{
	Super::BeginPlay();
	if (bBuildOnBeginPlay && Made.Num() == 0) Build();
}

void AValdradaCell::Clear()
{
	for (UInstancedStaticMeshComponent* C : Made) if (C) C->DestroyComponent();
	Made.Reset(); BuiltInstances = 0;
}

int32 AValdradaCell::Build()
{
	Clear();
	const double T0 = FPlatformTime::Seconds();
	FString Path = TablePath;
	if (FPaths::IsRelative(Path)) Path = FPaths::Combine(FPaths::ProjectDir(), Path);
	TArray<uint8> Bytes;
	if (!FFileHelper::LoadFileToArray(Bytes, *Path)) { UE_LOG(LogValdradaCell, Warning, TEXT("%s: no table at %s"), *GetName(), *Path); return 0; }
	FReader R(Bytes);
	const uint32 Magic = R.U32(), Version = R.U32(), Sets = R.U32();
	if (Magic != 0x4C454356u || Version != 1) { UE_LOG(LogValdradaCell, Warning, TEXT("%s: not a version 1 table: %s"), *GetName(), *Path); return 0; }
	for (uint32 S = 0; S < Sets && !R.bBad; ++S)
	{
		const FString MeshPath = R.Str();
		const uint16 NMat = R.U16();
		TArray<FString> MatPaths; for (uint16 M = 0; M < NMat; ++M) MatPaths.Add(R.Str());
		const uint32 Flags = R.U32(), NCustom = R.U32(), N = R.U32();
		const float* X = R.Floats(int64(N) * 12);
		const float* Cd = R.Floats(int64(N) * NCustom);
		if (R.bBad) break;
		UStaticMesh* Mesh = LoadObject<UStaticMesh>(nullptr, *MeshPath);
		if (!Mesh) { UE_LOG(LogValdradaCell, Warning, TEXT("%s: no mesh %s"), *GetName(), *MeshPath); continue; }
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(this, NAME_None, RF_Transient);
		C->SetMobility(EComponentMobility::Static);
		C->SetStaticMesh(Mesh);
		for (int32 M = 0; M < MatPaths.Num(); ++M)
			if (!MatPaths[M].IsEmpty())
				if (UMaterialInterface* Mi = LoadObject<UMaterialInterface>(nullptr, *MatPaths[M])) C->SetMaterial(M, Mi);
		C->SetCastShadow((Flags & 1u) != 0);
		// (no collision: a physics body per instance kept the game thread minutes in Chaos's pending spatial queue
		// before the first frame, as in the persistent city's kit; renders trace nothing)
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision); C->SetCollisionProfileName(UCollisionProfile::NoCollision_ProfileName);
		C->SetGenerateOverlapEvents(false); C->SetCanEverAffectNavigation(false);
		C->SetupAttachment(RootComponent);
		C->NumCustomDataFloats = int32(NCustom);
		TArray<FTransform> Xf; Xf.Reserve(N);
		for (uint32 I = 0; I < N; ++I)
		{
			const float* V = X + int64(I) * 12;
			const FMatrix M(FPlane(V[0], V[1], V[2], 0.f), FPlane(V[3], V[4], V[5], 0.f), FPlane(V[6], V[7], V[8], 0.f), FPlane(V[9], V[10], V[11], 1.f));
			Xf.Emplace(M);
		}
		C->AddInstances(Xf, false, false, false);
		if (NCustom > 0)
		{
			C->PerInstanceSMCustomData.SetNumUninitialized(int32(N * NCustom));
			FMemory::Memcpy(C->PerInstanceSMCustomData.GetData(), Cd, sizeof(float) * N * NCustom);
		}
		C->RegisterComponent();
		AddInstanceComponent(C);
		Made.Add(C);
		BuiltInstances += int32(N);
	}
	if (R.bBad) UE_LOG(LogValdradaCell, Warning, TEXT("%s: the table ends early: %s"), *GetName(), *Path);
	BuildSeconds = float(FPlatformTime::Seconds() - T0);
	UE_LOG(LogValdradaCell, Log, TEXT("%s: %d sets, %d instances in %.3f s from %s"), *GetName(), Made.Num(), BuiltInstances, BuildSeconds, *Path);
	return BuiltInstances;
}
