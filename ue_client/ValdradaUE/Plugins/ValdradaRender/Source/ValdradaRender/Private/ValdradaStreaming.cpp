// render.load -> the city's levels and tables. The core's streaming manager (core/streaming/stream.mjs) names the 128 m
// cells of its loaded grid and the far chunks it draws; the version 2 city build (tools/ue/city_build.py) holds the cells'
// meshes per 1 km block (/Game/CCB/<key>/L) with each cell's kit as a table (ValdradaCells), and the far city as one level
// per package (/Game/CF/<key>/L). The cut is city_cut's for one frame: every block a cell of the set falls in is near and
// drawn by its block level and its cells' tables (with the blocks of a landmark that touches them); over the rest each
// drawn chunk, made disjoint from the near blocks by going down to its children (an L3 block without its own chunk as its
// L4 cut to the block, B_), each L6 square's water where its chunk is not drawn whole, the city's ground per block where
// no whole L6 draws it (GB_), the bridges' pieces over blocks that are not near, every other landmark unless a block of it
// is near, and each near edge block's package for the part its cells do not draw (R_, LMBR_).
#include "ValdradaClient.h"
#include "ValdradaCell.h"
#include "Dom/JsonObject.h"
#include "Dom/JsonValue.h"
#include "Engine/LevelStreamingDynamic.h"
#include "Engine/World.h"
#include "Misc/FileHelper.h"
#include "Misc/Paths.h"
#include "Misc/CommandLine.h"
#include "Misc/Parse.h"
#include "Components/StaticMeshComponent.h"
#include "Engine/StaticMesh.h"
#include "Engine/Level.h"
#include "Engine/Engine.h"
#include "PipelineStateCache.h"
#include "Components/PrimitiveComponent.h"
#include "Serialization/JsonReader.h"
#include "Serialization/JsonSerializer.h"
#if WITH_EDITOR
#include "ShaderCompiler.h"
#include "AssetCompilingManager.h"
#endif

DEFINE_LOG_CATEGORY_STATIC(LogValdradaStream, Log, All);

namespace
{
	FIntPoint Key2(const FString& K)
	{
		FString A, B;
		K.Split(TEXT("_"), &A, &B);
		return FIntPoint(FCString::Atoi(*A), FCString::Atoi(*B));
	}
	FString KeyOf(const FIntPoint& P) { return FString::Printf(TEXT("%d_%d"), P.X, P.Y); }
	int32 FloorDiv(int32 A, int32 B) { return int32(FMath::FloorToDouble(double(A) / double(B))); }
}

void AValdradaClient::LoadCity()
{
	const FString Path = FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/city.json"));
	FString Text;
	if (!FFileHelper::LoadFileToString(Text, *Path)) { UE_LOG(LogValdradaStream, Error, TEXT("no city manifest at %s (Tools/make_manifests.py)"), *Path); return; }
	TSharedPtr<FJsonObject> J;
	if (!FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(Text), J) || !J.IsValid()) { UE_LOG(LogValdradaStream, Error, TEXT("%s is not JSON"), *Path); return; }
	J->TryGetNumberField(TEXT("cell"), City.Cell);
	J->TryGetNumberField(TEXT("block"), City.Block);
	for (const auto& KV : J->GetObjectField(TEXT("blocks"))->Values) City.Blocks.Add(Key2(FString(*KV.Key)), KV.Value->AsString());
	for (const auto& KV : J->GetObjectField(TEXT("city_blocks"))->Values) City.CityBlocks.Add(Key2(FString(*KV.Key)), int32(KV.Value->AsNumber()));
	for (const auto& KV : J->GetObjectField(TEXT("cells"))->Values)
	{
		const FString K(*KV.Key);
		City.CellTables.Add(K, KV.Value->AsString());
		City.CellsOfBlock.FindOrAdd(BlockOf(K)).Add(K);
	}
	for (const auto& KV : J->GetObjectField(TEXT("far"))->Values) City.Far.Add(FString(*KV.Key), KV.Value->AsString());
	for (const TSharedPtr<FJsonValue>& V : J->GetArrayField(TEXT("chunks"))) City.Chunks.Add(V->AsString());
	for (const auto& KV : J->GetObjectField(TEXT("landmarks"))->Values)
	{
		const TSharedPtr<FJsonObject> L = KV.Value->AsObject();
		const TArray<TSharedPtr<FJsonValue>>& B = L->GetArrayField(TEXT("bounds"));
		FCity::FLandmark M;
		M.Key = FString(*KV.Key);
		M.Lo = FVector3d(B[0]->AsNumber(), B[1]->AsNumber(), B[2]->AsNumber());
		M.Hi = FVector3d(B[3]->AsNumber(), B[4]->AsNumber(), B[5]->AsNumber());
		M.bBridge = L->GetBoolField(TEXT("bridge"));
		City.Landmarks.Add(M);
	}
	City.bOk = true;
	FString CText;
	TSharedPtr<FJsonObject> CJ;
	if (FFileHelper::LoadFileToString(CText, *FPaths::Combine(FPaths::ProjectDir(), TEXT("Data/classes.json"))) && FJsonSerializer::Deserialize(TJsonReaderFactory<>::Create(CText), CJ) && CJ.IsValid())
		for (const auto& KV : CJ->Values)
		{
			TMap<FString, uint8>& M = LevelClasses.Add(FString(*KV.Key));
			for (const auto& E : KV.Value->AsObject()->Values) M.Add(FString(*E.Key), uint8(E.Value->AsNumber()));
		}
	else UE_LOG(LogValdradaStream, Warning, TEXT("no Data/classes.json: the city draws unlabelled in semantic captures"));
	UE_LOG(LogValdradaStream, Log, TEXT("city: %d block levels, %d cell tables, %d far levels, %d landmarks"), City.Blocks.Num(), City.CellTables.Num(), City.Far.Num(), City.Landmarks.Num());
}

FIntPoint AValdradaClient::BlockOf(const FString& CellKey) const
{
	const FIntPoint C = Key2(CellKey);
	return FIntPoint(int32(FMath::FloorToDouble(C.X * City.Cell / City.Block)), int32(FMath::FloorToDouble(C.Y * City.Cell / City.Block)));
}

FIntPoint AValdradaClient::BlockAt(double X, double Z) const
{
	return FIntPoint(int32(FMath::FloorToDouble(X / City.Block)), int32(FMath::FloorToDouble(Z / City.Block)));
}

void AValdradaClient::OnLoad(const TSharedPtr<FJsonObject>& L)
{
	if (!L.IsValid() || !City.bOk) return;
	LastLoad = L;
	double F = 0;
	L->TryGetNumberField(TEXT("frame"), F);
	LoadFrame = int64(F);
	LoadSeq = L->TryGetNumberField(TEXT("seq"), F) ? int64(F) : -1;
	// ---- the near blocks
	TSet<FIntPoint> Near;
	for (const TCHAR* Field : { TEXT("cells"), TEXT("cells_missing") })
	{
		const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
		if (L->TryGetArrayField(Field, A))
			for (const TSharedPtr<FJsonValue>& V : *A)
			{
				const FIntPoint B = BlockOf(V->AsString());
				if (City.CityBlocks.Contains(B)) Near.Add(B);
			}
	}
	TArray<FString> LmDraw;
	for (const FCity::FLandmark& M : City.Landmarks)
	{
		if (M.bBridge) continue;
		TSet<FIntPoint> Bl;
		for (double X : { M.Lo.X, M.Hi.X }) for (double Z : { M.Lo.Z, M.Hi.Z }) Bl.Add(BlockAt(X, Z));
		const FIntPoint Cb = BlockAt((M.Lo.X + M.Hi.X) / 2, (M.Lo.Z + M.Hi.Z) / 2);
		if (Bl.Intersect(Near).Num() > 0) { for (const FIntPoint& B : Bl) if (City.CityBlocks.Contains(B)) Near.Add(B); }
		else if (!Near.Contains(Cb)) LmDraw.Add(TEXT("LM_") + M.Key);
	}
	// ---- the far chunks, disjoint from the near blocks
	TMap<FIntPoint, int32> Desired;   // block -> the finest level a drawn chunk gives it
	auto Draw = [&](const FString& Ck)
	{
		TArray<FString> P;
		Ck.ParseIntoArray(P, TEXT("_"));
		if (P.Num() != 3 || !P[0].StartsWith(TEXT("L"))) return;
		const int32 Lv = FCString::Atoi(*P[0].Mid(1)), I = FCString::Atoi(*P[1]), Jj = FCString::Atoi(*P[2]), S = 1 << FMath::Max(0, Lv - 3);
		for (int32 Bx = I * S; Bx < (I + 1) * S; ++Bx)
			for (int32 Bz = Jj * S; Bz < (Jj + 1) * S; ++Bz)
			{
				int32& D = Desired.FindOrAdd(FIntPoint(Bx, Bz), 9);
				D = FMath::Min(D, Lv);
			}
	};
	const TArray<TSharedPtr<FJsonValue>>* A = nullptr;
	if (L->TryGetArrayField(TEXT("chunks"), A)) for (const TSharedPtr<FJsonValue>& V : *A) Draw(V->AsString());
	// a chunk mid-fade switches at half its alpha (load-set.md: a renderer without a dither)
	if (L->TryGetArrayField(TEXT("fading"), A))
		for (const TSharedPtr<FJsonValue>& V : *A)
		{
			const TArray<TSharedPtr<FJsonValue>>& Fd = V->AsArray();
			if (Fd.Num() >= 2 && Fd[1]->AsNumber() >= 0.5) Draw(Fd[0]->AsString());
		}
	// (a block the cells do not draw though the city has none there stays far: its finest chunk)
	TSet<FString> Want;
	TSet<FIntPoint> L6Whole;
	TFunction<bool(int32, int32, int32)> Cut = [&](int32 Lv, int32 I, int32 Jj) -> bool
	{
		const int32 S = 1 << (Lv - 3);
		TArray<FIntPoint> Wanted;
		bool bAnyNear = false;
		for (int32 Bx = I * S; Bx < (I + 1) * S; ++Bx)
			for (int32 Bz = Jj * S; Bz < (Jj + 1) * S; ++Bz)
			{
				const FIntPoint B(Bx, Bz);
				if (Near.Contains(B)) { bAnyNear = true; continue; }
				if (Desired.Contains(B)) Wanted.Add(B);
			}
		if (Wanted.Num() == 0) return false;
		const FString Ck = FString::Printf(TEXT("L%d_%d_%d"), Lv, I, Jj);
		int32 MinD = 9;
		for (const FIntPoint& B : Wanted) MinD = FMath::Min(MinD, Desired[B]);
		if (City.Chunks.Contains(Ck) && !bAnyNear && MinD >= Lv)
		{
			Want.Add(Ck);
			if (Lv == 6) for (int32 Bx = I * S; Bx < (I + 1) * S; ++Bx) for (int32 Bz = Jj * S; Bz < (Jj + 1) * S; ++Bz) L6Whole.Add(FIntPoint(Bx, Bz));
			return true;
		}
		if (Lv == 3)
		{
			const FString Bk = FString::Printf(TEXT("B_%d_%d"), I, Jj);
			if (City.Far.Contains(Bk)) Want.Add(Bk);
			return false;
		}
		for (int32 Di = 0; Di < 2; ++Di) for (int32 Dj = 0; Dj < 2; ++Dj) Cut(Lv - 1, 2 * I + Di, 2 * Jj + Dj);
		return false;
	};
	TSet<FIntPoint> Roots;
	for (const auto& KV : Desired) Roots.Add(FIntPoint(FloorDiv(KV.Key.X, 8), FloorDiv(KV.Key.Y, 8)));
	for (const FIntPoint& R : Roots)
	{
		const bool bWhole = Cut(6, R.X, R.Y);
		const FString Wk = FString::Printf(TEXT("W_L6_%d_%d"), R.X, R.Y);
		if (!bWhole && City.Far.Contains(Wk)) Want.Add(Wk);
	}
	for (const auto& KV : Desired)
	{
		const FIntPoint& B = KV.Key;
		if (Near.Contains(B) || L6Whole.Contains(B) || !City.CityBlocks.Contains(B)) continue;
		const FString Gk = TEXT("GB_") + KeyOf(B);
		if (City.Far.Contains(Gk)) Want.Add(Gk);
	}
	for (const auto& KV : City.Far)
	{
		const FString& Name = KV.Key;
		if (!Name.StartsWith(TEXT("LMB_")) && !Name.StartsWith(TEXT("LMBR_"))) continue;
		TArray<FString> P;
		Name.ParseIntoArray(P, TEXT("_"));
		if (P.Num() < 3) continue;
		const FIntPoint B(FCString::Atoi(*P[P.Num() - 2]), FCString::Atoi(*P[P.Num() - 1]));
		// the bridges' pieces over the blocks that are not near; over a near edge block, the part outside the city
		if (Name.StartsWith(TEXT("LMBR_")) ? Near.Contains(B) : !Near.Contains(B)) Want.Add(Name);
	}
	for (const FString& Lm : LmDraw) if (City.Far.Contains(Lm)) Want.Add(Lm);
	for (const FIntPoint& B : Near)
	{
		const int32* N = City.CityBlocks.Find(B);
		const FString Rk = TEXT("R_") + KeyOf(B);
		if (N && *N < 64 && City.Far.Contains(Rk)) Want.Add(Rk);
	}
	// ---- the levels and tables this set holds
	TSet<FString> WantLevels;
	for (const FString& K : Want)
		if (const FString* Lv = City.Far.Find(K))
		{
			WantLevels.Add(*Lv);
			// segRender.js classes: water 18, terrain 15, bridge 35, building 2 (the far shells hold the towers)
			LevelDefault.Add(*Lv, K.StartsWith(TEXT("W_")) ? 18 : K.StartsWith(TEXT("GB_")) ? 15 : K.StartsWith(TEXT("LMB")) ? 35 : 2);
		}
	TSet<FString> WantCells;
	for (const FIntPoint& B : Near)
	{
		if (const FString* Lv = City.Blocks.Find(B)) WantLevels.Add(*Lv);
		if (const TArray<FString>* Cs = City.CellsOfBlock.Find(B)) for (const FString& C : *Cs) WantCells.Add(C);
	}
	int32 Added = 0, Removed = 0;
	UWorld* W = GetWorld();
	for (auto It = Levels.CreateIterator(); It; ++It)
	{
		if (WantLevels.Contains(It.Key())) continue;
		if (ULevelStreamingDynamic* S = It.Value()) S->SetIsRequestingUnloadAndRemoval(true);
		Labelled.Remove(It.Key());
		CollisionOff.Remove(It.Key());
		It.RemoveCurrent();
		++Removed;
	}
	for (const FString& Lv : WantLevels)
	{
		if (Levels.Contains(Lv)) continue;
		bool bOk = false;
		const FString Obj = Lv + TEXT(".") + FPaths::GetBaseFilename(Lv);
		ULevelStreamingDynamic* S = ULevelStreamingDynamic::LoadLevelInstanceBySoftObjectPtr(W, TSoftObjectPtr<UWorld>(FSoftObjectPath(Obj)), FTransform::Identity, bOk);
		if (!bOk || !S) { UE_LOG(LogValdradaStream, Warning, TEXT("cannot stream %s"), *Lv); continue; }
		S->SetShouldBeVisible(true);
		S->OnLevelLoaded.AddDynamic(this, &AValdradaClient::OnStreamedLevelLoaded);
		Levels.Add(Lv, S);
		++Added;
	}
	int32 CellsAdded = 0, CellsRemoved = 0;
	for (auto It = CellActors.CreateIterator(); It; ++It)
	{
		if (WantCells.Contains(It.Key())) continue;
		if (AValdradaCell* C = It.Value()) C->Destroy();
		CellQueue.Remove(It.Key());
		It.RemoveCurrent();
		++CellsRemoved;
	}
	for (const FString& C : WantCells)
	{
		if (CellActors.Contains(C)) continue;
		AValdradaCell* Cell = W->SpawnActorDeferred<AValdradaCell>(AValdradaCell::StaticClass(), FTransform::Identity, this);
		if (!Cell) continue;
		Cell->TablePath = FPaths::Combine(TablesDir, City.CellTables[C] + TEXT(".vcel"));
		Cell->bBuildOnBeginPlay = false;
		Cell->FinishSpawning(FTransform::Identity);
		CellActors.Add(C, Cell);
		CellQueue.Add(C);
		++CellsAdded;
	}
	LastPending = -1;
	LoadT0 = FPlatformTime::Seconds();
	TMap<FString, int32> ByKind;
	for (const FString& K : Want) { FString P, R; ByKind.FindOrAdd(K.Split(TEXT("_"), &P, &R) ? P : K)++; }
	FString Kinds;
	for (const auto& KV : ByKind) Kinds += FString::Printf(TEXT(" %s %d"), *KV.Key, KV.Value);
	Note(FString::Printf(TEXT("load %lld (%lld): %d near blocks, %d far packages (%s); levels +%d -%d (%d), cells +%d -%d (%d)"), LoadFrame, LoadSeq, Near.Num(), Want.Num(), *Kinds,
		Added, Removed, Levels.Num(), CellsAdded, CellsRemoved, CellActors.Num()));
}

void AValdradaClient::StepStreaming()
{
	static bool bDumped = false;
	if (!bDumped && FParse::Param(FCommandLine::Get(), TEXT("ValdradaDumpLevel")))
		for (const auto& KV : Levels)
		{
			const ULevelStreamingDynamic* S = KV.Value;
			if (!S || !KV.Key.StartsWith(TEXT("/Game/CCB/")) || S->GetLevelStreamingState() != ELevelStreamingState::LoadedVisible || !S->GetLoadedLevel()) continue;
			bDumped = true;
			int32 N = 0;
			for (AActor* A : S->GetLoadedLevel()->Actors)
			{
#if WITH_EDITOR
				if (!A || A->GetActorLabel().StartsWith(TEXT("s")) || N++ > 40) continue;
#else
				if (!A || N++ > 40) continue;
#endif
				FString Comps;
				A->ForEachComponent<UStaticMeshComponent>(false, [&](UStaticMeshComponent* C) { Comps += FString::Printf(TEXT(" [%s %s %s]"), *C->GetName(), *C->GetClass()->GetName(), C->GetStaticMesh() ? *C->GetStaticMesh()->GetName() : TEXT("-")); });
#if WITH_EDITOR
				const FString Label = A->GetActorLabel();
#else
				const FString Label;
#endif
				UE_LOG(LogValdradaStream, Log, TEXT("dump %s: %s label '%s' tags %d%s"), *KV.Key, *A->GetName(), *Label, A->Tags.Num(), *Comps);
			}
			break;
		}
	// no capture waiting: the load set at once (a renderer that is loading draws nothing anyone reads)
	const bool bAtOnce = Captures.Num() == 0;
	if (bAtOnce && bFlushLoads)
	{
		int32 Lv = 0;
		for (const auto& KV : Levels)
			if (KV.Value && KV.Value->GetLevelStreamingState() != ELevelStreamingState::LoadedVisible && KV.Value->GetLevelStreamingState() != ELevelStreamingState::FailedToLoad) ++Lv;
		if (Lv > 0)
		{
			const double T = FPlatformTime::Seconds();
			GetWorld()->FlushLevelStreaming(EFlushLevelStreamingType::Full);
			Note(FString::Printf(TEXT("streamed %d levels in %.1f s"), Lv, FPlatformTime::Seconds() - T));
		}
	}
	for (int32 N = 0; (bAtOnce || N < CellBuildsPerFrame) && CellQueue.Num() > 0; ++N)
	{
		const FString C = CellQueue[0];
		CellQueue.RemoveAt(0);
		if (TObjectPtr<AValdradaCell>* A = CellActors.Find(C))
			if (*A)
			{
				(*A)->Build();
				// the kit's parts: facade parts for the most part (the dresser's windows, sills, cornices)
				(*A)->ForEachComponent<UPrimitiveComponent>(false, [](UPrimitiveComponent* P) { LabelComponent(P, 2); });
			}
	}
	for (const auto& KV : Levels)
	{
		ULevelStreamingDynamic* S = KV.Value;
		if (!S || Labelled.Contains(KV.Key) || S->GetLevelStreamingState() != ELevelStreamingState::LoadedVisible || !S->GetLoadedLevel()) continue;
		Labelled.Add(KV.Key);
		LabelLevel(KV.Key, S->GetLoadedLevel());
	}
}

int32 AValdradaClient::PendingCount(int32* OutLevels, int32* OutCells, int32* OutShaders) const
{
	int32 Lv = 0;
	for (const auto& KV : Levels)
	{
		const ULevelStreamingDynamic* S = KV.Value;
		if (S && S->GetLevelStreamingState() != ELevelStreamingState::LoadedVisible && S->GetLevelStreamingState() != ELevelStreamingState::FailedToLoad) ++Lv;
	}
	// the pipeline states being compiled for what just came in (a cooked build compiles them on this machine the first
	// time a material is drawn: a frame waiting on them can take minutes on a cold cache), and the precache requests still
	// queued: a component is not drawn until its own are done, so a load reported while the city's thousands queued (the
	// file cache's precompile tasks alone counted) left every car, walker and id copy undrawn for minutes
	int32 Sh = PipelineStateCache::GetNumActivePipelinePrecompileTasks() + int32(PipelineStateCache::NumActivePrecacheRequests());
#if WITH_EDITOR
	// an editor build compiles the materials' shaders and builds the meshes it has not cached yet; a frame drawn before they
	// are in shows the default material
	if (GShaderCompilingManager) Sh += GShaderCompilingManager->GetNumRemainingJobs();
	Sh += FAssetCompilingManager::Get().GetNumRemainingAssets();
#endif
	if (OutLevels) *OutLevels = Lv;
	if (OutCells) *OutCells = CellQueue.Num();
	if (OutShaders) *OutShaders = Sh;
	return Lv + CellQueue.Num() + Sh;
}

void AValdradaClient::ReportLoaded(bool bForce)
{
	if (!Link || !Link->IsConnected() || LoadFrame < 0) return;
	int32 Lv = 0, Ce = 0, Sh = 0;
	const int32 P = PendingCount(&Lv, &Ce, &Sh);
	const double Now = FPlatformTime::Seconds();
	if (!bForce && P == LastPending && (P == 0 || Now - LastLoadedSent < 1.0)) return;
	if (P == 0 && LastPending != 0) Note(FString::Printf(TEXT("load %lld in: %.1f s"), LoadSeq, Now - LoadT0));
	LastPending = P;
	LastLoadedSent = Now;
	TSharedRef<FJsonObject> Pa = MakeShared<FJsonObject>();
	Pa->SetNumberField(TEXT("frame"), double(LoadFrame));
	if (LoadSeq >= 0) Pa->SetNumberField(TEXT("seq"), double(LoadSeq));
	Pa->SetNumberField(TEXT("pending"), P);
	TSharedRef<FJsonObject> R = MakeShared<FJsonObject>();
	R->SetNumberField(TEXT("levels"), Levels.Num());
	R->SetNumberField(TEXT("cells"), CellActors.Num());
	R->SetNumberField(TEXT("levels_pending"), Lv);
	R->SetNumberField(TEXT("cells_pending"), Ce);
	R->SetNumberField(TEXT("compiling"), Sh);
	Pa->SetObjectField(TEXT("resident"), R);
	SendRequest(TEXT("render.loaded"), Pa);
	if (P > 0 && Now - LastWarn > 10.0)
	{
		LastWarn = Now;
		Note(FString::Printf(TEXT("loading: %d levels, %d cell tables, %d shaders, pipelines and meshes to go"), Lv, Ce, Sh));
	}
}

void AValdradaClient::LabelComponent(UPrimitiveComponent* C, int32 Cls)
{
	if (!C || Cls <= 0) return;
	C->SetCustomDepthStencilValue(Cls);
	C->SetRenderCustomDepth(true);
}

// a block level's components by their mesh's name (the importer names a merged mesh g<n> after its node and an instance
// set's prototype p<n> after its set s<n>); the tree kit's shared parts (SM_*_lod<k>) are vegetation; a far level's by its
// package's kind
void AValdradaClient::LabelLevel(const FString& Path, ULevel* Level)
{
	const TMap<FString, uint8>* M = LevelClasses.Find(Path);
	const uint8 Def = LevelDefault.FindRef(Path);
	int32 N = 0, Hit = 0;
	for (AActor* A : Level->Actors)
	{
		if (!A) continue;
		A->ForEachComponent<UPrimitiveComponent>(false, [&](UPrimitiveComponent* P)
		{
			int32 Cls = Def;
			const UStaticMeshComponent* SC = Cast<UStaticMeshComponent>(P);
			const FString Mesh = SC && SC->GetStaticMesh() ? SC->GetStaticMesh()->GetName() : FString();
			if (M)
			{
				FString Key;
				if (Mesh.Len() > 1 && Mesh[0] == TEXT('g') && FCString::IsNumeric(*Mesh.Mid(1))) Key = Mesh;
				else if (Mesh.Len() > 1 && Mesh[0] == TEXT('p') && FCString::IsNumeric(*Mesh.Mid(1))) Key = TEXT("s") + Mesh.Mid(1);
#if WITH_EDITOR
				else
				{
					const FString Label = A->GetActorLabel();
					int32 U = INDEX_NONE;
					if (Label.StartsWith(TEXT("s")) && Label.FindChar(TEXT('_'), U)) Key = Label.Left(U);
				}
#endif
				if (const uint8* C = M->Find(Key)) { Cls = *C; ++Hit; }
				else if (Mesh.StartsWith(TEXT("SM_")) && Mesh.Contains(TEXT("_lod"))) Cls = 17;
			}
			LabelComponent(P, Cls);
			++N;
		});
	}
	UE_LOG(LogValdradaStream, Verbose, TEXT("labelled %s: %d components, %d by the class table"), *Path, N, Hit);
}

void AValdradaClient::OnStreamedLevelLoaded()
{
	int32 N = 0;
	for (const auto& KV : Levels)
	{
		ULevelStreamingDynamic* S = KV.Value;
		if (!S || CollisionOff.Contains(KV.Key) || !S->GetLoadedLevel()) continue;
		CollisionOff.Add(KV.Key);
		for (AActor* A : S->GetLoadedLevel()->Actors)
		{
			if (!A) continue;
			A->SetActorEnableCollision(false);
			A->ForEachComponent<UPrimitiveComponent>(false, [&N](UPrimitiveComponent* P)
			{
				P->SetCollisionEnabled(ECollisionEnabled::NoCollision);
				P->SetGenerateOverlapEvents(false);
				++N;
			});
		}
	}
	UE_LOG(LogValdradaStream, Verbose, TEXT("collision off on %d components"), N);
}
