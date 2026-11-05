// The crowd's photoreal walkers (Data/crowd.json, Tools/make_crowd.py): each walker of the state a skeletal body of its
// variant (the add record's seed picks it, as crowd.js setAnim picks from its pool), sized as crowd.js _heightScale sizes
// it, playing its body's idle, walk or run clip with the web crowd's rate (the walker's speed over the clip's natural speed
// at its hips, crowd.js rateOf); a copy in M_client_id follows its pose for the instance capture. A body that leaves is
// hidden and kept for the next walker.
#include "ValdradaClient.h"
#include "ValdradaFrames.h"
#include "Components/SkeletalMeshComponent.h"
#include "Engine/SkeletalMesh.h"
#include "Animation/AnimSequence.h"
#include "Animation/AnimSingleNodeInstance.h"
#include "Materials/MaterialInstanceDynamic.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Serialization/JsonSerializer.h"

namespace
{
	// crowd.js hash (a walker's deterministic draws from its seed)
	float Hash(int32 A, int32 B = 0)
	{
		uint32 H = uint32(A ^ int32(0x9e3779b9)) * 0x85ebca6bu ^ uint32(B) * 0xc2b2ae35u;
		H ^= H >> 15; H *= 0x2c1b3c6du; H ^= H >> 12;
		return float(H % 100003u) / 100003.f;
	}
	const TCHAR* const Roles[3] = { TEXT("idle"), TEXT("walk"), TEXT("run") };
}

void AValdradaClient::LoadCrowd()
{
	FString Text;
	TSharedPtr<FJsonObject> J;
	if (!FFileHelper::LoadFileToString(Text, *FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/crowd.json"))) ||
		!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), J) || !J.IsValid())
	{
		Note(TEXT("crowd: no Data/crowd.json, walkers drawn as capsules"));
		return;
	}
	int32 Missing = 0;
	for (const TSharedPtr<FJsonValue>& V : J->GetArrayField(TEXT("variants")))
	{
		const TSharedPtr<FJsonObject> O = V->AsObject();
		FCrowdVariant C;
		C.Name = O->GetStringField(TEXT("name"));
		O->TryGetStringField(TEXT("gender"), C.Gender);
		FString Age;
		C.bChild = O->TryGetStringField(TEXT("age"), Age) && Age == TEXT("child");
		double D = 1;
		if (O->TryGetNumberField(TEXT("scale"), D)) C.Scale = float(D);
		if (O->TryGetNumberField(TEXT("height"), D)) C.Height = float(D);
		if (O->TryGetNumberField(TEXT("hips"), D)) C.Hips = float(D);
		if (O->TryGetNumberField(TEXT("ref_hips"), D)) C.RefHips = float(D);
		const FString MeshPath = O->GetStringField(TEXT("mesh"));
		C.Mesh = LoadObject<USkeletalMesh>(nullptr, *MeshPath);
		const TSharedPtr<FJsonObject>* An = nullptr;
		if (O->TryGetObjectField(TEXT("anims"), An))
			for (int32 R = 0; R < 3; ++R)
			{
				const TSharedPtr<FJsonObject>* A = nullptr;
				if (!(*An)->TryGetObjectField(Roles[R], A)) continue;
				C.Anim[R] = LoadObject<UAnimSequence>(nullptr, *(*A)->GetStringField(TEXT("path")));
				if ((*A)->TryGetNumberField(TEXT("seconds"), D) && D > 0) C.Seconds[R] = float(D);
				if ((*A)->TryGetNumberField(TEXT("speed"), D)) C.Speed[R] = float(D);
				if (C.Anim[R]) KeepAlive.Add(C.Anim[R]);
			}
		const TSharedPtr<FJsonObject>* Sl = nullptr;
		if (O->TryGetObjectField(TEXT("slots"), Sl))
			for (const auto& KV : (*Sl)->Values)
			{
				UMaterialInterface* Mi = LoadObject<UMaterialInterface>(nullptr, *KV.Value->AsString());
				if (Mi) { C.Slots.Emplace(FName(KV.Key), Mi); KeepAlive.Add(Mi); }
				else ++Missing;
			}
		if (!C.Mesh || !C.Anim[0] || !C.Anim[1]) { ++Missing; continue; }
		KeepAlive.Add(C.Mesh);
		Crowd.Add(MoveTemp(C));
	}
	Note(FString::Printf(TEXT("crowd: %d photoreal variants (%d assets missing)"), Crowd.Num(), Missing));
	// one body per variant made now, dressed and hidden in the pool: their pipeline states precache while the city loads,
	// and the load waits for them (a cooked client compiles them on this machine the first time; a body made at its
	// walker's first frame was held back for minutes)
	for (const FCrowdVariant& C : Crowd)
	{
		FWalkerBody B = NewWalkerBody();
		B.Body->SetSkeletalMesh(C.Mesh);
		for (const TPair<FName, UMaterialInterface*>& S : C.Slots)
		{
			const int32 Slot = B.Body->GetMaterialIndex(S.Key);
			if (Slot != INDEX_NONE) B.Body->SetMaterial(Slot, S.Value);
		}
		B.Body->PrecachePSOs();
		B.Body->SetVisibility(false);
		if (B.Id)
		{
			B.Id->SetSkeletalMesh(C.Mesh);
			for (int32 Slot = 0; Slot < B.Id->GetNumMaterials(); ++Slot) B.Id->SetMaterial(Slot, B.IdMid);
			B.Id->SetLeaderPoseComponent(B.Body);
			B.Id->PrecachePSOs();
			B.Id->SetVisibility(false);
		}
		FreeBodies.Add(B);
	}
}

AValdradaClient::FWalkerBody AValdradaClient::NewWalkerBody()
{
	FWalkerBody B;
	B.Body = NewObject<USkeletalMeshComponent>(this);
	B.Body->SetupAttachment(RootComponent);
	B.Body->SetCollisionEnabled(ECollisionEnabled::NoCollision);
	B.Body->SetGenerateOverlapEvents(false);
	B.Body->VisibilityBasedAnimTickOption = EVisibilityBasedAnimTickOption::AlwaysTickPoseAndRefreshBones;
	B.Body->bPauseAnims = true;   // (the client sets each frame's clip time)
	B.Body->RegisterComponent();
	LabelComponent(B.Body, 23);
	if (IdMat)
	{
		B.Id = NewObject<USkeletalMeshComponent>(this);
		B.Id->SetupAttachment(B.Body);
		B.Id->SetCollisionEnabled(ECollisionEnabled::NoCollision);
		B.Id->SetCastShadow(false);
		B.Id->bAffectDistanceFieldLighting = false;
		B.Id->bVisibleInRayTracing = false;
		B.Id->SetAffectDynamicIndirectLighting(false);
		B.Id->SetVisibleInSceneCaptureOnly(true);
		B.Id->RegisterComponent();
		B.IdMid = UMaterialInstanceDynamic::Create(IdMat, this);
		AddIdComponent(B.Id);
	}
	return B;
}

void AValdradaClient::DrawWalkerBodies(const TArray<FWalkerRec>& Recs, float Dt)
{
	static const float TargetH[3] = { 1.77f, 1.65f, 1.22f };   // crowd.js TARGET_H: m, f, child
	TSet<int32> Seen;
	Seen.Reserve(Recs.Num());
	for (const FWalkerRec& R : Recs)
	{
		Seen.Add(R.Id);
		const FStatic* St = Statics.Find(R.Id);
		const float Skin = St && St->Skin >= 0.f ? St->Skin : Hash(R.Id, 1);
		const int32 Vi = FMath::Clamp(int32(Skin * Crowd.Num()), 0, Crowd.Num() - 1);
		const FCrowdVariant& C = Crowd[Vi];
		FWalkerBody* W = WalkerBodies.Find(R.Id);
		if (!W)
		{
			FWalkerBody NewBody;
			if (FreeBodies.Num() > 0) NewBody = FreeBodies.Pop();
			if (!NewBody.Body)
			{
				NewBody = NewWalkerBody();
			}
			NewBody.Body->SetVisibility(true);
			if (NewBody.Id) NewBody.Id->SetVisibility(true);
			NewBody.Variant = -1; NewBody.Clip = -1; NewBody.Code = 0;
			W = &WalkerBodies.Add(R.Id, NewBody);
		}
		if (W->Variant != Vi)
		{
			W->Variant = Vi;
			W->Clip = -1;
			W->Body->SetSkeletalMesh(C.Mesh);
			for (const TPair<FName, UMaterialInterface*>& S : C.Slots)
			{
				const int32 Slot = W->Body->GetMaterialIndex(S.Key);
				if (Slot != INDEX_NONE) W->Body->SetMaterial(Slot, S.Value);
			}
			W->Body->SetAnimationMode(EAnimationMode::AnimationSingleNode);
			if (W->Id)
			{
				W->Id->SetSkeletalMesh(C.Mesh);
				for (int32 Slot = 0; Slot < W->Id->GetNumMaterials(); ++Slot) W->Id->SetMaterial(Slot, W->IdMid);
				W->Id->SetLeaderPoseComponent(W->Body);
			}
		}
		if (W->Id && W->Code != R.Code)
		{
			W->Code = R.Code;
			W->IdMid->SetVectorParameterValue(TEXT("Code"), FLinearColor(float(R.Code & 255) / 255.f, float((R.Code >> 8) & 255) / 255.f, float((R.Code >> 16) & 255) / 255.f, 0.f));
		}
		// the clip: idle while standing, the run past 2.6 m/s where the body has one, the walk otherwise
		const bool bWalking = R.Amp > 0 && R.V > 0.05f;
		const int32 Clip = !bWalking ? 0 : (R.V > 2.6f && C.Anim[2]) ? 2 : 1;
		const int32 Key = Skin >= 0.f ? int32(Skin * 1e6f) : R.Id;
		const float Hs = FMath::Clamp(TargetH[C.bChild ? 2 : C.Gender == TEXT("f") ? 1 : 0] * (0.96f + 0.08f * Hash(Key, 3)) / (C.Height * C.Scale), 0.7f, 1.1f);
		const float K = C.Scale * Hs;
		if (W->Clip != Clip)
		{
			W->Clip = Clip;
			W->Body->SetAnimation(C.Anim[Clip]);
			// (a walk starts at the walker's gait phase, an idle somewhere in its loop by the seed: crowd.js)
			W->T = Clip == 0 ? Hash(Key, 7) * C.Seconds[0] : R.Phase * C.Seconds[Clip];
		}
		else if (Clip > 0 && C.Speed[Clip] > 0.1f)
		{
			const float Gait = (C.Hips / FMath::Max(0.1f, C.RefHips)) * K;
			W->T += Dt * FMath::Clamp(R.V / (C.Speed[Clip] * Gait), 0.5f, 2.3f);
		}
		else W->T += Dt;
		if (UAnimSingleNodeInstance* Inst = W->Body->GetSingleNodeInstance())
			Inst->SetPosition(float(FMath::Fmod(W->T, double(C.Seconds[Clip]))), false);
		// the feet on the pavement, the heading about +y (0 facing +z): the body faces +Y in Unreal as the fleet does
		const FQuat Q = Valdrada::Quat(0.0, FMath::Sin(R.Yaw * 0.5), 0.0, FMath::Cos(R.Yaw * 0.5));
		W->Body->SetWorldLocationAndRotation(Valdrada::Pos(R.P[0], R.P[1], R.P[2]), Q);
		W->Body->SetWorldScale3D(FVector(K));
	}
	// the walkers that left: their bodies hidden for the next ones
	for (auto It = WalkerBodies.CreateIterator(); It; ++It)
	{
		if (Seen.Contains(It.Key())) continue;
		FWalkerBody B = It.Value();
		B.Body->SetVisibility(false);
		if (B.Id) B.Id->SetVisibility(false);
		B.Body->SetWorldLocation(FVector(0, 0, -100000));
		FreeBodies.Add(B);
		It.RemoveCurrent();
	}
}
