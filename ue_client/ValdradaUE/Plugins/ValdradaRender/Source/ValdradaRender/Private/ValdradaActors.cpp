// render.state -> the road users. The state's blob is one ATRK v1 frame block (docs/specs/actor-tracks.md): 52-byte
// vehicle records, 44-byte walker records, one signal byte per listed junction, 72-byte train car records; actors.add
// names each actor once (a parked vehicle with its pose). Vehicles of a kind are one instanced mesh, every frame placed
// from the records: the kind's mesh from FleetPath/<kind>/SM_<kind> when the fleet library holds it, else a box of the
// kind's size. Walkers are the crowd's photoreal bodies (ValdradaCrowd.cpp; capsule stand-ins without Data/crowd.json or with
// -ValdradaCapsules), train cars boxes (the train sets are not in this client yet). Every vehicle and walker drawn also has
// a copy in M_client_id that only the instance capture sees (ValdradaCapture.cpp): for a vehicle the same instance slot in a
// twin instanced mesh whose per-instance data holds its 24-bit code.
#include "ValdradaClient.h"
#include "ValdradaLink.h"
#include "ValdradaFrames.h"
#include "Components/InstancedStaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Components/SceneCaptureComponent2D.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"

DEFINE_LOG_CATEGORY_STATIC(LogValdradaActors, Log, All);

namespace
{
	constexpr int32 VehBytes = 52, WalkBytes = 44, TrainBytes = 72;
	template <typename T> T Rd(const uint8* P) { T V; FMemory::Memcpy(&V, P, sizeof(T)); return V; }

	// segRender.js classifyVehicle: the semantic class of a fleet kind
	int32 VehicleClass(const FString& Kind)
	{
		if (Kind == TEXT("bus") || Kind == TEXT("minibus")) return 20;
		static const TCHAR* Trucks[] = { TEXT("sprinter"), TEXT("ambulance"), TEXT("vwvan"), TEXT("van"), TEXT("truck"), TEXT("firetruck"), TEXT("carlacola"), TEXT("cybertruck") };
		for (const TCHAR* T : Trucks) if (Kind.Contains(T, ESearchCase::IgnoreCase)) return 21;
		return 19;
	}

	UInstancedStaticMeshComponent* MakeISM(AActor* Owner, UStaticMesh* Mesh)
	{
		UInstancedStaticMeshComponent* C = NewObject<UInstancedStaticMeshComponent>(Owner);
		C->SetMobility(EComponentMobility::Movable);
		C->SetStaticMesh(Mesh);
		C->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		C->SetupAttachment(Owner->GetRootComponent());
		C->RegisterComponent();
		return C;
	}
}

namespace
{
	struct FItem { int32 Id; FTransform Xf; uint32 Code; uint8 Lamps = 0; };

	// the code's three bytes as the copy's per-instance data (M_client_id writes them as its colour)
	void SetCode(UInstancedStaticMeshComponent* IdC, int32 I, uint32 Code)
	{
		const float D[3] = { float(Code & 255) / 255.f, float((Code >> 8) & 255) / 255.f, float((Code >> 16) & 255) / 255.f };
		IdC->SetCustomData(I, TArrayView<const float>(D, 3), true);
	}

	// C and its id copy IdC (when present) hold the same slots: an actor keeps its slot while it is drawn
	template <typename TSlots>
	void SyncSlots(UInstancedStaticMeshComponent* C, UInstancedStaticMeshComponent* IdC, TSlots& S, const TArray<FItem>& Items)
	{
		TSet<int32> Seen;
		Seen.Reserve(Items.Num());
		for (const FItem& It : Items)
		{
			Seen.Add(It.Id);
			if (const int32* I = S.Slot.Find(It.Id))
			{
				C->UpdateInstanceTransform(*I, It.Xf, true, false, false);
				if (IdC) IdC->UpdateInstanceTransform(*I, It.Xf, true, false, false);
				continue;
			}
			int32 I = S.Free.Num() > 0 ? S.Free.Pop() : INDEX_NONE;
			if (I == INDEX_NONE)
			{
				I = C->AddInstance(It.Xf, true);
				if (IdC) { const int32 J = IdC->AddInstance(It.Xf, true); check(J == I); }
			}
			else
			{
				C->UpdateInstanceTransform(I, It.Xf, true, false, true);   // (a reused slot jumps: no motion from its last actor)
				if (IdC) IdC->UpdateInstanceTransform(I, It.Xf, true, false, true);
			}
			if (IdC) SetCode(IdC, I, It.Code);
			S.Slot.Add(It.Id, I);
		}
		// the lamp mask (the record's lamps) as the instance's first float, for M_client_lamp, where the kind has lamps
		if (C->NumCustomDataFloats > 0)
			for (const FItem& It : Items)
			{
				const int32 I = S.Slot.FindChecked(It.Id);
				uint8& L = S.Lamps.FindOrAdd(I, 255);
				if (L != It.Lamps) { C->SetCustomDataValue(I, 0, float(It.Lamps), true); L = It.Lamps; }
			}
		const FTransform Away(FQuat::Identity, FVector(0, 0, -100000), FVector::ZeroVector);
		for (auto It = S.Slot.CreateIterator(); It; ++It)
		{
			if (Seen.Contains(It.Key())) continue;
			C->UpdateInstanceTransform(It.Value(), Away, true, false, true);
			if (IdC) { IdC->UpdateInstanceTransform(It.Value(), Away, true, false, true); SetCode(IdC, It.Value(), 0); }
			S.Free.Add(It.Value());
			It.RemoveCurrent();
		}
		// (no render state rebuild: the component's instance data manager sends the changed instances; rebuilding every
		// non-Nanite instance buffer each frame ran Vulkan's upload heap out of memory and lost the device)
	}

	// three.js's heading of a body rotation (the model faces +z): atan2 of its forward axis's x and z
	float HeadingOf(float Qx, float Qy, float Qz, float Qw)
	{
		return FMath::Atan2(2.f * (Qx * Qz + Qw * Qy), 1.f - 2.f * (Qx * Qx + Qy * Qy));
	}
}

uint32 AValdradaClient::CodeFor(const FString& Key)
{
	int32& L = LabelIds.FindOrAdd(Key, 0);
	if (L == 0) L = NextLabel++;
	return uint32((uint64(L) * 3635641ull) & 0xFFFFFFull);
}

UInstancedStaticMeshComponent* AValdradaClient::MakeIdISM(UStaticMesh* Mesh)
{
	if (!IdMat) return nullptr;
	UInstancedStaticMeshComponent* C = MakeISM(this, Mesh);
	C->SetNumCustomDataFloats(3);
	for (int32 Slot = 0; Slot < FMath::Max(1, C->GetNumMaterials()); ++Slot) C->SetMaterial(Slot, IdMat);
	C->SetCastShadow(false);
	C->bAffectDistanceFieldLighting = false;
	C->bVisibleInRayTracing = false;
	C->SetAffectDynamicIndirectLighting(false);
	C->SetVisibleInSceneCaptureOnly(true);
	C->MarkRenderStateDirty();
	AddIdComponent(C);
	return C;
}

void AValdradaClient::AddIdComponent(UPrimitiveComponent* C)
{
	IdComponents.Add(C);
	// every capture but the instance ones leaves the copies out; the instance ones draw only them
	for (TPair<FString, FCam>& KV : Cams)
	{
		FCam& K = KV.Value;
		for (USceneCaptureComponent2D* S : { K.Rgb.Get(), K.Depth.Get(), K.Sem.Get(), K.Alb.Get(), K.Nrm.Get() }) if (S) S->HideComponent(C);
		if (K.Inst) K.Inst->ShowOnlyComponent(C);
	}
}

void AValdradaClient::SetupKinds(const TArray<TSharedPtr<FJsonValue>>& Kinds)
{
	if (KindNames.Num() == Kinds.Num()) return;
	UStaticMesh* Box = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube"));
	int32 Fleet = 0, Wheels = 0;
	FString Boxes;
	if (!FleetTable.IsValid())
	{
		FString Text;
		TSharedPtr<FJsonObject> T;
		if (FFileHelper::LoadFileToString(Text, *FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/fleet.json"))) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), T) && T.IsValid())
		{
			const TSharedPtr<FJsonObject>* K = nullptr;
			if (T->TryGetObjectField(TEXT("kinds"), K)) FleetTable = *K;
		}
		if (!FleetTable.IsValid()) { Note(TEXT("fleet: no Data/fleet.json, vehicles drawn without their wheels' own meshes")); FleetTable = MakeShared<FJsonObject>(); }
	}
	// a kind's wheels: its own entry's, or the model it repaints (taxi2: the lincoln's)
	auto WheelsOf = [&](const FString& Name, const FString& Base) -> TArray<FWheel>
	{
		TArray<FWheel> Out;
		const TSharedPtr<FJsonObject>* E = nullptr;
		if (!FleetTable->TryGetObjectField(Name, E) && (Base.IsEmpty() || !FleetTable->TryGetObjectField(Base, E))) return Out;
		const TArray<TSharedPtr<FJsonValue>>* Ws = nullptr;
		if (!(*E)->TryGetArrayField(TEXT("wheels"), Ws)) return Out;
		for (const TSharedPtr<FJsonValue>& V : *Ws)
		{
			const TSharedPtr<FJsonObject> O = V->AsObject();
			FWheel W;
			W.Mesh = LoadObject<UStaticMesh>(nullptr, *O->GetStringField(TEXT("mesh")), nullptr, LOAD_NoWarn | LOAD_Quiet);
			double Hp[3] = { 0, 0, 0 };
			if (!W.Mesh || !Valdrada::Num3(O, TEXT("p"), Hp, 3)) continue;
			W.Hub = FVector3f(Hp[0], Hp[1], Hp[2]);
			W.bFront = O->GetNumberField(TEXT("n")) <= 2;
			KeepAlive.Add(W.Mesh);
			Out.Add(W);
		}
		return Out;
	};
	for (const TSharedPtr<FJsonValue>& V : Kinds)
	{
		const TSharedPtr<FJsonObject> K = V->AsObject();
		const FString Name = K->GetStringField(TEXT("kind"));
		double Sz[3] = { 1.9, 1.5, 4.6 };
		Valdrada::Num3(K, TEXT("size"), Sz, 3);
		KindNames.Add(Name);
		KindSizes.Add(FVector3f(Sz[0], Sz[1], Sz[2]));
		// a kind that repaints another's model (taxi2: the lincoln in the TLC yellow) draws that model
		FString Model = Name, Base;
		UStaticMesh* M = LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("%s/%s/SM_%s.SM_%s"), *FleetPath, *Model, *Model, *Model), nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!M && K->TryGetStringField(TEXT("base"), Base) && !Base.IsEmpty())
			M = LoadObject<UStaticMesh>(nullptr, *FString::Printf(TEXT("%s/%s/SM_%s.SM_%s"), *FleetPath, *Base, *Base, *Base), nullptr, LOAD_NoWarn | LOAD_Quiet);
		FString Palette;
		KindTaxiPaint.Add(M && !Base.IsEmpty() && K->TryGetStringField(TEXT("palette"), Palette) && Palette == TEXT("taxi"));
		KindIsBox.Add(M == nullptr);
		if (M) ++Fleet; else Boxes += TEXT(" ") + Name;
		KindMesh.Add(M ? M : Box);
		KindISM.Add(nullptr);
		KindSlots.AddDefaulted();
		KindWheels.Add(M ? WheelsOf(Name, Base) : TArray<FWheel>());
		Wheels += KindWheels.Last().Num();
	}
	UE_LOG(LogValdradaActors, Log, TEXT("%d vehicle kinds, %d from the fleet library, %d wheels; boxes:%s"), KindNames.Num(), Fleet, Wheels, *Boxes);
	Note(FString::Printf(TEXT("fleet: %d vehicle kinds, %d from the fleet library, %d wheels"), KindNames.Num(), Fleet, Wheels));
	// every kind's meshes made now, empty: their pipeline states precache while the city loads, and the load waits for them
	// (a cooked client compiles them on this machine the first time; a kind made at its first car was held back for minutes)
	for (int32 K = 0; K < KindNames.Num(); ++K) if (!KindIsBox[K]) EnsureKindISM(K);
}

void AValdradaClient::EnsureKindISM(int32 K)
{
	if (!KindISM.IsValidIndex(K)) return;
	if (KindIdISM.Num() != KindISM.Num()) KindIdISM.SetNum(KindISM.Num());
	if (!KindISM[K])
	{
		KindIdISM[K] = MakeIdISM(KindMesh[K]);
		KindISM[K] = MakeISM(this, KindMesh[K]);
		LabelComponent(KindISM[K], VehicleClass(KindNames[K]));
		// the windows dark, glossy and opaque (M_client_glass): the models' translucent glass showed the cabins through the
		// roofs (the browser draws its glass at 0.62 over a lit cabin)
		if (GlassMat)
			for (int32 Slot = 0; Slot < KindISM[K]->GetNumMaterials(); ++Slot)
			{
				UMaterialInterface* Mi = KindISM[K]->GetMaterial(Slot);
				if (Mi && Mi->GetName().Contains(TEXT("glass"), ESearchCase::IgnoreCase)) KindISM[K]->SetMaterial(Slot, GlassMat);
			}
		// the lamps and sirens (M_client_lamp: their role per vertex, the instance's lamp mask): the slots whose name ends
		// in lamp or siren (the models' lamp parts), and their inner lenses, lampInner, which carry the lamps' roles: on the
		// SUV, the mini, the vans, the minibus and the trucks they sit in front of the lamps, and dark, they hid them lit
		if (LampMat)
		{
			const TArray<FName> Names = KindISM[K]->GetMaterialSlotNames();
			bool bLamps = false;
			for (int32 Slot = 0; Slot < Names.Num(); ++Slot)
			{
				const FString N = Names[Slot].ToString();
				if (!N.EndsWith(TEXT("lamp"), ESearchCase::IgnoreCase) && !N.EndsWith(TEXT("siren"), ESearchCase::IgnoreCase) &&
					!N.EndsWith(TEXT("lampInner"), ESearchCase::IgnoreCase)) continue;
				KindISM[K]->SetMaterial(Slot, LampMat);
				bLamps = true;
			}
			if (bLamps) KindISM[K]->SetNumCustomDataFloats(1);
		}
		if (KindTaxiPaint.IsValidIndex(K) && KindTaxiPaint[K])
		{
			// the body paint in the taxi yellow (the importer's glTF material: its base colour factor)
			for (int32 Slot = 0; Slot < KindISM[K]->GetNumMaterials(); ++Slot)
			{
				UMaterialInterface* Mi = KindISM[K]->GetMaterial(Slot);
				if (!Mi || !Mi->GetName().Contains(TEXT("paint"), ESearchCase::IgnoreCase)) continue;
				UMaterialInstanceDynamic* Paint = KindISM[K]->CreateDynamicMaterialInstance(Slot, Mi);
				for (const TCHAR* Param : { TEXT("BaseColorFactor"), TEXT("Base Color Factor"), TEXT("BaseColor") })
					Paint->SetVectorParameterValue(Param, FLinearColor(0.95f, 0.62f, 0.02f));
			}
		}
		// (its slots' own materials now: the precache made at registration had the model's)
		KindISM[K]->PrecachePSOs();
		if (KindIdISM[K]) KindIdISM[K]->PrecachePSOs();
	}
	if (!KindWheels.IsValidIndex(K)) return;
	for (FWheel& Wh : KindWheels[K])
		if (!Wh.ISM)
		{
			Wh.IdISM = MakeIdISM(Wh.Mesh);
			Wh.ISM = MakeISM(this, Wh.Mesh);
			LabelComponent(Wh.ISM, VehicleClass(KindNames[K]));
		}
}

void AValdradaClient::SetupTrains(const TArray<TSharedPtr<FJsonValue>>& Kinds)
{
	if (TrainKinds.Num() == Kinds.Num()) return;
	FString Text;
	TSharedPtr<FJsonObject> T;
	const TSharedPtr<FJsonObject>* K = nullptr;
	const bool bTable = FFileHelper::LoadFileToString(Text, *FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/trains.json"))) &&
		FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), T) && T.IsValid() && T->TryGetObjectField(TEXT("kinds"), K);
	int32 N = 0;
	for (const TSharedPtr<FJsonValue>& V : Kinds)
	{
		const FString Name = V->AsString();
		UStaticMesh* Mesh = nullptr;
		const TSharedPtr<FJsonObject>* E = nullptr;
		if (bTable && (*K)->TryGetObjectField(Name, E)) Mesh = LoadObject<UStaticMesh>(nullptr, *(*E)->GetStringField(TEXT("mesh")), nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (Mesh) { KeepAlive.Add(Mesh); ++N; }
		TrainKinds.Add(Name);
		TrainMesh.Add(Mesh);
		TrainKindISM.Add(nullptr);
		TrainKindSlots.AddDefaulted();
	}
	// (each kind's mesh made now, empty, so its pipeline states precache while the city loads: SetupKinds)
	for (int32 Tk = 0; Tk < TrainMesh.Num(); ++Tk) if (TrainMesh[Tk] && !TrainKindISM[Tk]) TrainKindISM[Tk] = MakeISM(this, TrainMesh[Tk]);
	Note(FString::Printf(TEXT("trains: %d kinds, %d with their models"), TrainKinds.Num(), N));
}

void AValdradaClient::OnState(FValdradaMessage& M)
{
	const TSharedPtr<FJsonObject>& J = M.Json;
	++StatesSeen;
	const TSharedPtr<FJsonObject>* O = nullptr;
	if (J->TryGetObjectField(TEXT("env"), O)) ApplyEnv(*O);
	if (J->TryGetObjectField(TEXT("view"), O)) ApplyView(*O);
	if (J->TryGetObjectField(TEXT("actors"), O))
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if ((*O)->TryGetArrayField(TEXT("remove"), A)) for (const TSharedPtr<FJsonValue>& V : *A) Statics.Remove(int32(V->AsNumber()));
		if ((*O)->TryGetArrayField(TEXT("add"), A))
			for (const TSharedPtr<FJsonValue>& V : *A)
			{
				const TSharedPtr<FJsonObject> R = V->AsObject();
				FStatic S;
				S.Type = R->GetStringField(TEXT("type"));
				double Skin = -1;
				if (S.Type == TEXT("walker") && R->TryGetNumberField(TEXT("variant"), Skin)) S.Skin = float(Skin);   // (the crowd's seed: it picks the variant)
				if (S.Type == TEXT("parked"))
				{
					double P[3] = { R->GetNumberField(TEXT("x")), R->GetNumberField(TEXT("y")), R->GetNumberField(TEXT("z")) }, Q[4] = { 0, 0, 0, 1 };
					Valdrada::Num3(R, TEXT("q"), Q, 4);
					S.Kind = int32(R->GetNumberField(TEXT("kind_index")));
					S.Xf = FTransform(Valdrada::Quat(Q[0], Q[1], Q[2], Q[3]), Valdrada::Pos(P[0], P[1], P[2]));
				}
				Statics.Add(int32(R->GetNumberField(TEXT("id"))), S);
			}
	}
	if (M.Blobs.Num() == 0 || KindNames.Num() == 0) return;
	const TArray<uint8>& B = M.Blobs[0];
	if (B.Num() < 8) return;
	const uint8* D = B.GetData();
	const int32 NV = Rd<uint16>(D), NW = Rd<uint16>(D + 2), NS = Rd<uint16>(D + 4), NT = Rd<uint16>(D + 6);
	const int64 Need = 8 + int64(NV) * VehBytes + int64(NW) * WalkBytes + ((NS + 3) & ~3) + int64(NT) * TrainBytes;
	if (B.Num() < Need) { UE_LOG(LogValdradaActors, Warning, TEXT("a state's frame block is short: %d of %lld bytes"), B.Num(), Need); return; }
	TArray<TArray<FItem>> PerKind;
	PerKind.SetNum(KindNames.Num());
	TArray<TArray<TArray<FItem>>> PerWheel;   // kind -> wheel -> items
	PerWheel.SetNum(KindNames.Num());
	for (int32 K = 0; K < KindWheels.Num() && K < PerWheel.Num(); ++K) PerWheel[K].SetNum(KindWheels[K].Num());
	// a wheel turned by spin about its axle (the model's x), the front pair steered about y, at its hub (fleet24.js f24Wheel)
	auto PlaceWheels = [&](int32 Kind, int32 Id, const FTransform& Body, float Spin, float Steer, uint32 Code)
	{
		if (!KindWheels.IsValidIndex(Kind)) return;
		const FQuat Qs = Valdrada::Quat(FMath::Sin(Spin * 0.5f), 0.0, 0.0, FMath::Cos(Spin * 0.5f));
		const FQuat Qt = Valdrada::Quat(0.0, FMath::Sin(Steer * 0.5f), 0.0, FMath::Cos(Steer * 0.5f));
		for (int32 W = 0; W < KindWheels[Kind].Num(); ++W)
		{
			const FWheel& Wh = KindWheels[Kind][W];
			const FTransform Local((Wh.bFront ? Qt * Qs : Qs), Valdrada::Pos(Wh.Hub.X, Wh.Hub.Y, Wh.Hub.Z));
			PerWheel[Kind][W].Add({ Id, Local * Body, Code });
		}
	};
	Things.Reset();
	ThingOfCode.Reset();
	// a road user's label row (segRender.js writeVehicleCodes: the key, its class, its pose in the core's frame)
	auto Thing = [&](int32 Id, const FString& Key, uint8 Cls, const float* Pos, float Yaw, const FVector3f& Dims, const FString& KindName, float Speed, bool bMoving) -> uint32
	{
		FThing& T = Things.AddDefaulted_GetRef();
		T.Id = Id; T.Key = Key; T.Cls = Cls; T.Yaw = Yaw; T.Dims = Dims; T.Kind = KindName; T.Speed = Speed; T.bMoving = bMoving;
		FMemory::Memcpy(T.P, Pos, sizeof(T.P));
		T.Code = CodeFor(Key);
		T.Label = LabelIds[Key];
		ThingOfCode.Add(T.Code, Things.Num() - 1);
		return T.Code;
	};
	// (bridge.js labelActor maps keys ending in api<id> to the API actor; the recorder's own ids start at 1,000,000)
	auto Who = [](int32 Id) { return Id < 1000000 ? FString::Printf(TEXT("api%d"), Id) : FString::FromInt(Id); };
	auto Place = [&](int32 Kind, int32 Id, const FTransform& Body, uint32 Code, uint8 Lamps)
	{
		if (!PerKind.IsValidIndex(Kind)) return;
		if (KindIsBox[Kind])
		{
			// the model's frame: it faces +z with its left side at +x (sim/fleet24.js), Unreal +Y and +X; size [w, h, l]
			const FVector3f& S = KindSizes[Kind];
			PerKind[Kind].Add({ Id, FTransform(FQuat::Identity, FVector(0, 0, S.Y * 50.0), FVector(S.X, S.Z, S.Y)) * Body, Code });
		}
		else PerKind[Kind].Add({ Id, Body, Code, Lamps });
	};
	const uint8* P = D + 8;
	for (int32 I = 0; I < NV; ++I, P += VehBytes)
	{
		const float Pos[3] = { Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12) };
		const float Qv[4] = { Rd<float>(P + 16), Rd<float>(P + 20), Rd<float>(P + 24), Rd<float>(P + 28) };
		const FVector L = Valdrada::Pos(Pos[0], Pos[1], Pos[2]);
		const FQuat Q = Valdrada::Quat(Qv[0], Qv[1], Qv[2], Qv[3]);
		const int32 Kind = Rd<uint16>(P + 50), Id = int32(Rd<uint32>(P));
		uint32 Code = 0;
		if (KindNames.IsValidIndex(Kind))
			Code = Thing(Id, FString::Printf(TEXT("veh:%s:%s"), *KindNames[Kind], *Who(Id)), uint8(VehicleClass(KindNames[Kind])), Pos,
				HeadingOf(Qv[0], Qv[1], Qv[2], Qv[3]), KindSizes[Kind], KindNames[Kind], Rd<float>(P + 32), true);
		Place(Kind, Id, FTransform(Q, L), Code, Rd<uint8>(P + 48));
		PlaceWheels(Kind, Id, FTransform(Q, L), Rd<float>(P + 36), Rd<float>(P + 40), Code);
	}
	for (const TPair<int32, FStatic>& KV : Statics)
	{
		if (KV.Value.Type != TEXT("parked") || !KindNames.IsValidIndex(KV.Value.Kind)) continue;
		const int32 Kind = KV.Value.Kind;
		const FVector L = KV.Value.Xf.GetLocation();
		const float Pos[3] = { float(L.X * 0.01), float(L.Z * 0.01), float(L.Y * 0.01) };
		const FQuat Q = KV.Value.Xf.GetRotation();   // (Unreal's: back to the core's (-x, -z, -y, w))
		const uint32 Code = Thing(KV.Key, FString::Printf(TEXT("veh:%s:%s"), *KindNames[Kind], *Who(KV.Key)), uint8(VehicleClass(KindNames[Kind])), Pos,
			HeadingOf(float(-Q.X), float(-Q.Z), float(-Q.Y), float(Q.W)), KindSizes[Kind], KindNames[Kind], 0.f, false);
		Place(Kind, KV.Key, KV.Value.Xf, Code, 0);
		PlaceWheels(Kind, KV.Key, KV.Value.Xf, 0.f, 0.f, Code);
	}
	TArray<FItem> Walkers;
	TArray<FWalkerRec> WalkerRecs;
	Walkers.Reserve(NW);
	for (int32 I = 0; I < NW; ++I, P += WalkBytes)
	{
		const float Sy = Rd<float>(P + 36), Sxz = Rd<float>(P + 32);
		const float Pos[3] = { Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12) };
		const FVector L = Valdrada::Pos(Pos[0], Pos[1], Pos[2]);
		const float H = 1.72f * (Sy > 0.f ? Sy : 1.f);
		const int32 Id = int32(Rd<uint32>(P));
		const FStatic* St = Statics.Find(Id);
		// (segRender.js: a standing or walking walker's pose at its feet, 0.55 x 1.75 x 0.4 m)
		const uint32 Code = Thing(Id, FString::Printf(TEXT("ped:%s"), *Who(Id)), 23, Pos, Rd<float>(P + 16), FVector3f(0.55f, 1.75f, 0.4f),
			St ? St->Type : FString(), Rd<float>(P + 20), Rd<uint8>(P + 40) > 0);
		Walkers.Add({ Id, FTransform(FQuat::Identity, L + FVector(0, 0, H * 50.f), FVector(0.42f * (Sxz > 0.f ? Sxz : 1.f), 0.42f * (Sxz > 0.f ? Sxz : 1.f), H)), Code });
		WalkerRecs.Add({ Id, { Pos[0], Pos[1], Pos[2] }, Rd<float>(P + 16), Rd<float>(P + 20), Rd<float>(P + 24), Sxz, Sy, Rd<uint8>(P + 40), Rd<uint8>(P + 41), Code });
	}
	P += (NS + 3) & ~3;
	TArray<FItem> Cars;
	TArray<TArray<FItem>> CarsOfKind;
	CarsOfKind.SetNum(TrainKinds.Num());
	for (int32 I = 0; I < NT; ++I, P += TrainBytes)
	{
		const FVector L = Valdrada::Pos(Rd<float>(P + 4), Rd<float>(P + 8), Rd<float>(P + 12));
		const int32 Kind = Rd<uint8>(P + 65);
		// a car faces +x at yaw 0, turned about +y (up): about Unreal's Z the other way round; the reversed car of a married
		// pair faces the other way (actor-tracks.md flags bit 0)
		const float Yaw = Rd<float>(P + 16) + ((Rd<uint8>(P + 66) & 1) ? PI : 0.f);
		const FTransform Body(FQuat(FVector::UpVector, -Yaw), L);
		if (TrainMesh.IsValidIndex(Kind) && TrainMesh[Kind]) CarsOfKind[Kind].Add({ int32(Rd<uint32>(P)), Body, 0u });
		else Cars.Add({ int32(Rd<uint32>(P)), FTransform(FQuat::Identity, FVector(0, 0, 180), FVector(15.5, 2.6, 3.6)) * Body, 0u });
	}
	for (int32 K = 0; K < CarsOfKind.Num(); ++K)
	{
		if (!TrainMesh[K] || (CarsOfKind[K].Num() == 0 && !TrainKindISM[K])) continue;
		if (!TrainKindISM[K]) TrainKindISM[K] = MakeISM(this, TrainMesh[K]);
		SyncSlots(TrainKindISM[K], nullptr, TrainKindSlots[K], CarsOfKind[K]);
	}
	if (KindIdISM.Num() != KindISM.Num()) KindIdISM.SetNum(KindISM.Num());
	for (int32 K = 0; K < PerKind.Num(); ++K)
	{
		if (PerKind[K].Num() == 0 && !KindISM[K]) continue;
		if (!KindISM[K]) EnsureKindISM(K);
		SyncSlots(KindISM[K], KindIdISM[K].Get(), KindSlots[K], PerKind[K]);
		if (!KindWheels.IsValidIndex(K)) continue;
		for (int32 W = 0; W < KindWheels[K].Num(); ++W)
		{
			FWheel& Wh = KindWheels[K][W];
			if (!Wh.ISM) EnsureKindISM(K);
			SyncSlots(Wh.ISM, Wh.IdISM, Wh.Slots, PerWheel[K][W]);
		}
	}
	if (Crowd.Num() > 0)
	{
		double Dt = 0;
		J->TryGetNumberField(TEXT("dt"), Dt);
		DrawWalkerBodies(WalkerRecs, float(Dt));
	}
	else
	{
		if (!WalkerISM)
		{
			UStaticMesh* Cyl = LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cylinder.Cylinder"));
			WalkerIdISM = MakeIdISM(Cyl);
			WalkerISM = MakeISM(this, Cyl);
			LabelComponent(WalkerISM, 23);
		}
		SyncSlots(WalkerISM.Get(), WalkerIdISM.Get(), WalkerSlots, Walkers);
	}
	if (!TrainISM) TrainISM = MakeISM(this, LoadObject<UStaticMesh>(nullptr, TEXT("/Engine/BasicShapes/Cube.Cube")));
	SyncSlots(TrainISM.Get(), nullptr, TrainSlots, Cars);
}
