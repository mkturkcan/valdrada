#include "ValdradaNaniteFacades.h"
#include "Modules/ModuleManager.h"
#include "Engine/StaticMesh.h"
#include "StaticMeshAttributes.h"
#include "MeshDescription.h"
#include "Materials/Material.h"
#include "MaterialShared.h"
#include "Engine/EngineTypes.h"
#include "Materials/MaterialInstanceConstant.h"
#include "Materials/MaterialExpressionCustom.h"
#include "Materials/MaterialExpressionTextureCoordinate.h"
#include "Materials/MaterialExpressionVertexColor.h"
#include "AssetRegistry/AssetRegistryModule.h"
#include "UObject/SavePackage.h"
#include "UObject/Package.h"
#include "Misc/PackageName.h"
#include "Misc/FileHelper.h"
#include "HAL/PlatformTime.h"
#include "Math/Float16.h"
#include "Dom/JsonObject.h"
#include "Serialization/JsonWriter.h"
#include "Serialization/JsonSerializer.h"

IMPLEMENT_MODULE(FDefaultModuleImpl, ValdradaWorldEditor);
DEFINE_LOG_CATEGORY_STATIC(LogValdradaNanite, Log, All);

// ---- the packing (each UV component is a 20-bit code of Nanite's UV float, see NaniteEncodeGeometryData.cpp: 1 sign,
// 5 exponent and 14 mantissa bits, [0,1] denormal; the master's prologue recovers the code from the float)
//   C0 = a3x half << 4 | style & 15         C3 = floorH code (half - 1.0, 12 bits) << 8 | lit * 255
//   C1 = a3y half << 4 | flags >> 4          C4 = bay width code (12 bits) << 8 | cvar * 255
//   C2 = a3z half << 4 | flags & 15          C5 = store height code (0 or half - 1.0 + 1, 12 bits) << 8 | bldgH code >> 6
//   vertex colour: rgb = the colour (sRGB bytes), a = (bldgH code & 63) << 2 | (style >> 4 & 1) << 1
//   bldgH code: 0, or its half - 0.5 + 1 (14 bits, 0.5 to 2048 m); UV0 (the wall's metres) stays as it is
static float DecodeUVFloat(uint32 E)
{
	const uint32 M = (1u << 19) - 1u;
	const bool bNeg = E <= M;
	const uint32 EM = (bNeg ? ~E : E) & M;
	const uint32 FB = 0x3F000000u + (EM << 9);
	float R; FMemory::Memcpy(&R, &FB, 4);
	R = FMath::Min(R * 2.0f - 1.0f, R);
	return bNeg ? -R : R;
}
static uint32 EncodeUVFloat(float Value)   // (the engine's, NumMantissaBits 14)
{
	uint32 U; FMemory::Memcpy(&U, &Value, 4);
	const uint32 A = U & 0x7FFFFFFFu; uint32 R;
	if (A < 0x3F800000u) { float F; FMemory::Memcpy(&F, &A, 4); R = uint32(double(F * float(1u << 14)) + 0.5); }
	else R = FMath::Min(((A - 0x3F000000u) + (1u << 8)) >> 9, (1u << 19) - 1u);
	return R ^ ((1u << 19) - (U >> 31));
}
static uint32 HB(float X) { FFloat16 H(X); return H.Encoded; }
static float SrgbToLinear(float C) { return C <= 0.04045f ? C / 12.92f : FMath::Pow((C + 0.055f) / 1.055f, 2.4f); }
static float LinearToSrgb(float L) { L = FMath::Clamp(L, 0.f, 1.f); return L <= 0.0031308f ? L * 12.92f : 1.055f * FMath::Pow(L, 1.0f / 2.4f) - 0.055f; }

static const TCHAR* Prologue = TEXT(
"// ---- packed facade attributes (ValdradaNaniteFacades): UV 1-7 recovered from UV 1-3 (P1-P3) and the vertex colour (VC)\n"
"struct VPKS { uint k(float f) { uint u = asuint(f); uint a = u & 0x7FFFFFFFu; uint r;\n"
"  if (a < 0x3F800000u) r = (uint)(asfloat(a) * 16384.0 + 0.5); else r = min(((a - 0x3F000000u) + 256u) >> 9, 524287u);\n"
"  return r ^ (524288u - (u >> 31)); }\n"
"  float lin(float c) { return c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4); } };\n"
"VPKS vpk;\n"
"uint pc0 = vpk.k(P1.x), pc1 = vpk.k(P1.y), pc2 = vpk.k(P2.x), pc3 = vpk.k(P2.y), pc4 = vpk.k(P3.x), pc5 = vpk.k(P3.y);\n"
"uint pcA = (uint)(saturate(VA) * 255.0 + 0.5);\n"
"uint pShc = pc5 >> 8u, pBhc = ((pc5 & 255u) << 6u) | (pcA >> 2u);\n"
"float2 UV1 = float2(f16tof32((pc3 >> 8u) + 0x3C00u), f16tof32((pc4 >> 8u) + 0x3C00u));\n"
"float2 UV2 = float2(pShc == 0u ? 0.0 : f16tof32(pShc - 1u + 0x3C00u), (float)((pc0 & 15u) | (((pcA >> 1u) & 1u) << 4u)));\n"
"float2 UV3 = float2(pBhc == 0u ? 0.0 : f16tof32(pBhc - 1u + 0x3800u), (float)(pc3 & 255u) / 255.0);\n"
"float2 UV4 = float2((float)(pc4 & 255u) / 255.0, (float)(((pc1 & 15u) << 4u) | (pc2 & 15u)));\n"
"float2 UV5 = float2(f16tof32(pc0 >> 4u), f16tof32(pc1 >> 4u));\n"
"float2 UV6 = float2(f16tof32(pc2 >> 4u), vpk.lin(VC.r));\n"
"float2 UV7 = float2(vpk.lin(VC.g), vpk.lin(VC.b));\n"
"// ---- end packed\n");

struct FNanStats { TMap<FString, int32> Hist; int32 Meshes = 0, Done = 0, Already = 0, SkipUV = 0, SkipMat = 0, SkipLoad = 0, Variants = 0, Masters = 0; int64 Verts = 0, Clamped = 0, RoundTripBad = 0; TArray<FString> Errors; };

// the kit's glass sets (tk:fac:glass_*): every pane a separate quad, which Nanite drops at a distance (a tower drew its
// frames and spandrels with the sky through the panes, 2026-10-28: PreserveArea and the finest Nanite detail left 2 to 11 %
// of the panes open, the city's root pages hold the streaming pool at 512 MB); the glass stays out of Nanite, drawn whole.
// The same for the kit's other pane sets: tk:glass_* (the punched windows and the towers' own glass) and tk:litWindow_*
static bool KitGlass(const TArray<FStaticMaterial>& Mats)
{
	for (const FStaticMaterial& Sm : Mats)
	{
		if (!Sm.MaterialInterface) continue;
		const FString N = Sm.MaterialInterface->GetName();
		if (N.StartsWith(TEXT("tk_fac_glass")) || N.StartsWith(TEXT("tk_glass_")) || N.StartsWith(TEXT("tk_litWindow"))) return true;
	}
	return false;
}

static bool SaveAsset(UObject* Obj)
{
	UPackage* P = Obj->GetOutermost();
	const FString File = FPackageName::LongPackageNameToFilename(P->GetName(), Obj->IsA<UWorld>() ? FPackageName::GetMapPackageExtension() : FPackageName::GetAssetPackageExtension());
	FSavePackageArgs A; A.TopLevelFlags = RF_Public | RF_Standalone; A.SaveFlags = SAVE_NoError;
	return UPackage::SavePackage(P, Obj, *File, A);
}

static UMaterial* PackedMaster(UMaterial* Par, FNanStats& S, bool bCreate)
{
	const FString Pkg = Par->GetOutermost()->GetName() + TEXT("p"), Name = Par->GetName() + TEXT("p");
	if (UMaterial* M = FindObject<UMaterial>(nullptr, *(Pkg + TEXT(".") + Name))) return M;
	if (FPackageName::DoesPackageExist(Pkg)) return LoadObject<UMaterial>(nullptr, *(Pkg + TEXT(".") + Name));
	if (!bCreate) return nullptr;
	UPackage* P = CreatePackage(*Pkg);
	UMaterial* M = DuplicateObject<UMaterial>(Par, P, *Name);
	M->SetFlags(RF_Public | RF_Standalone);
	UMaterialExpressionCustom* C = nullptr;
	for (UMaterialExpression* E : M->GetExpressions()) if (UMaterialExpressionCustom* X = Cast<UMaterialExpressionCustom>(E)) if (X->Code.Contains(TEXT("vAux"))) C = X;
	if (!C) { S.Errors.Add(FString::Printf(TEXT("%s: no facade program"), *Par->GetPathName())); return nullptr; }
	C->Inputs.RemoveAll([](const FCustomInput& I) { const FString N = I.InputName.ToString(); return N.StartsWith(TEXT("UV")) && N != TEXT("UV0"); });
	for (int32 I = 1; I <= 3; ++I)
	{
		UMaterialExpressionTextureCoordinate* T = NewObject<UMaterialExpressionTextureCoordinate>(M); T->CoordinateIndex = I; T->Material = M;
		T->MaterialExpressionEditorX = -1100; T->MaterialExpressionEditorY = -1600 + I * 80;
		M->GetExpressionCollection().AddExpression(T);
		FCustomInput In; In.InputName = *FString::Printf(TEXT("P%d"), I); In.Input.Connect(0, T); C->Inputs.Add(In);
	}
	UMaterialExpressionVertexColor* V = NewObject<UMaterialExpressionVertexColor>(M); V->Material = M;
	V->MaterialExpressionEditorX = -1100; V->MaterialExpressionEditorY = -1200;
	M->GetExpressionCollection().AddExpression(V);
	{ FCustomInput In; In.InputName = TEXT("VC"); In.Input.Connect(0, V); C->Inputs.Add(In); }   // (output 0: rgb)
	{ FCustomInput In; In.InputName = TEXT("VA"); In.Input.Connect(4, V); C->Inputs.Add(In); }   // (output 4: alpha)
	C->Code = FString(Prologue) + C->Code;
	C->Description = C->Description + TEXT(" packed");
	M->PreEditChange(nullptr); M->PostEditChange();
	FAssetRegistryModule::AssetCreated(M);
	if (!SaveAsset(M)) S.Errors.Add(FString::Printf(TEXT("%s: not saved"), *Pkg));
	S.Masters++;
	UE_LOG(LogValdradaNanite, Display, TEXT("packed master %s"), *M->GetPathName());
	return M;
}

static UMaterialInstanceConstant* Variant(UMaterialInstanceConstant* MIC, UMaterial* Packed, FNanStats& S, bool bCreate)
{
	const FString Pkg = MIC->GetOutermost()->GetName() + TEXT("_nan"), Name = MIC->GetName() + TEXT("_nan");
	if (UMaterialInstanceConstant* V = FindObject<UMaterialInstanceConstant>(nullptr, *(Pkg + TEXT(".") + Name))) return V;
	if (FPackageName::DoesPackageExist(Pkg)) return LoadObject<UMaterialInstanceConstant>(nullptr, *(Pkg + TEXT(".") + Name));
	if (!bCreate) return nullptr;
	UPackage* P = CreatePackage(*Pkg);
	UMaterialInstanceConstant* V = DuplicateObject<UMaterialInstanceConstant>(MIC, P, *Name);
	V->SetFlags(RF_Public | RF_Standalone);
	V->SetParentEditorOnly(Packed);
	V->PostEditChange();
	FAssetRegistryModule::AssetCreated(V);
	if (!SaveAsset(V)) S.Errors.Add(FString::Printf(TEXT("%s: not saved"), *Pkg));
	S.Variants++;
	return V;
}

int32 UValdradaNaniteFacadesCommandlet::Main(const FString& Params)
{
	FString ListFile, OutFile; FParse::Value(*Params, TEXT("list="), ListFile); FParse::Value(*Params, TEXT("out="), OutFile);
	const bool bDry = FParse::Param(*Params, TEXT("dry"));
	const bool bVariantsOnly = FParse::Param(*Params, TEXT("variants"));   // (pass 1, one process: packed masters and instance copies; pass 2 in parallel needs them)
	TArray<FString> Paths; FFileHelper::LoadFileToStringArray(Paths, *ListFile);
	FNanStats S;
	// (-keepfallback -shard=i/n: every Nanite mesh with a translucent section keeps its fallback mesh, GenerateFallback
	// Enabled, so the cook may strip the others' (bGenerateNaniteFallbackMeshes=False): Nanite draws translucent sections
	// from the fallback, and a cook without them lost the water and the glass)
	if (FParse::Param(*Params, TEXT("keepfallback")))
	{
		FString Shard; int32 Si = 0, Sn = 1;
		if (FParse::Value(*Params, TEXT("shard="), Shard)) { FString A, B; Shard.Split(TEXT("/"), &A, &B); Si = FCString::Atoi(*A); Sn = FMath::Max(1, FCString::Atoi(*B)); }
		IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
		AR.SearchAllAssets(true);
		TArray<FAssetData> All; AR.GetAssetsByClass(UStaticMesh::StaticClass()->GetClassPathName(), All, true);
		All.Sort([](const FAssetData& X, const FAssetData& Y) { return X.PackageName.LexicalLess(Y.PackageName); });
		int32 Seen = 0, Nan = 0, Set = 0, Had = 0, Known = 0; TArray<FString> SetList;
		// (-known=<file>: packages checked by an earlier run are skipped and the file extended, so every cook can run it
		// on the meshes made since: a block rebuilt after the one full run had its water drawn from a stripped fallback,
		// the Central Park reservoir black and without depth, 2026-10-26)
		FString KnownFile; FParse::Value(*Params, TEXT("known="), KnownFile);
		TSet<FString> KnownSet; TArray<FString> KnownNew;
		if (!KnownFile.IsEmpty()) { TArray<FString> L; FFileHelper::LoadFileToStringArray(L, *KnownFile); KnownSet.Append(L); }
		for (int32 I = Si; I < All.Num(); I += Sn)
		{
			const FString Pn = All[I].PackageName.ToString();
			if (!Pn.StartsWith(TEXT("/Game/"))) continue;
			if (KnownSet.Contains(Pn)) { ++Known; continue; }
			if (!KnownFile.IsEmpty()) KnownNew.Add(Pn);
			UStaticMesh* SM = Cast<UStaticMesh>(All[I].GetAsset()); ++Seen;
			if (!SM || !SM->GetNaniteSettings().bEnabled) { if (Seen % 2000 == 0) CollectGarbage(RF_NoFlags); continue; }
			++Nan;
			bool bTr = false;
			for (const FStaticMaterial& Sm : SM->GetStaticMaterials())
				if (Sm.MaterialInterface && (IsTranslucentBlendMode(*Sm.MaterialInterface) || Sm.MaterialInterface->GetShadingModels().HasShadingModel(MSM_SingleLayerWater)
				                             || Sm.MaterialInterface->GetShadingModels().HasShadingModel(MSM_ThinTranslucent))) { bTr = true; break; }   // (water: Nanite draws single-layer water from the fallback too)
			if (bTr)
			{
				FMeshNaniteSettings NS = SM->GetNaniteSettings();
				if (NS.GenerateFallback == ENaniteGenerateFallback::Enabled) ++Had;
				else
				{
					NS.GenerateFallback = ENaniteGenerateFallback::Enabled; SM->SetNaniteSettings(NS);
					SM->MarkPackageDirty();
					if (SaveAsset(SM)) { ++Set; if (SetList.Num() < 30) SetList.Add(Pn); } else S.Errors.Add(Pn + TEXT(": not saved"));
				}
			}
			if (Seen % 2000 == 0) { UE_LOG(LogValdradaNanite, Display, TEXT("keepfallback %d seen, %d Nanite, %d set"), Seen, Nan, Set); CollectGarbage(RF_NoFlags); }
		}
		if (!KnownFile.IsEmpty() && KnownNew.Num() && !S.Errors.Num())
			FFileHelper::SaveStringToFile(FString::Join(KnownNew, TEXT("\n")) + TEXT("\n"), *KnownFile, FFileHelper::EEncodingOptions::AutoDetect, &IFileManager::Get(), FILEWRITE_Append);
		const FString Txt = FString::Printf(TEXT("{\"meshes\": %d, \"seen\": %d, \"known\": %d, \"nanite\": %d, \"set\": %d, \"had\": %d, \"errors\": %d, \"eg\": \"%s\"}"), All.Num(), Seen, Known, Nan, Set, Had, S.Errors.Num(), *FString::Join(SetList, TEXT(" ")));
		if (!OutFile.IsEmpty()) FFileHelper::SaveStringToFile(Txt, *OutFile);
		UE_LOG(LogValdradaNanite, Display, TEXT("keepfallback done %s"), *Txt);
		return S.Errors.Num() ? 1 : 0;
	}
	// (-glassraster -list=<meshes>: the packed meshes of the kit's glass sets taken out of Nanite; the packing does it for
	// meshes packed since, this mode for the ones packed before)
	if (FParse::Param(*Params, TEXT("glassraster")))
	{
		TArray<FString> L; FFileHelper::LoadFileToStringArray(L, *ListFile);
		int32 Seen = 0, Glass = 0, Set = 0, Had = 0;
		for (const FString& Path : L)
		{
			if (Path.IsEmpty()) continue;
			UStaticMesh* SM = LoadObject<UStaticMesh>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet); ++Seen;
			if (!SM) { S.Errors.Add(Path + TEXT(": not loaded")); continue; }
			if (KitGlass(SM->GetStaticMaterials()))
			{
				++Glass;
				FMeshNaniteSettings NS = SM->GetNaniteSettings();
				if (!NS.bEnabled) ++Had;
				else
				{
					NS.bEnabled = false; SM->SetNaniteSettings(NS); SM->MarkPackageDirty();
					if (SaveAsset(SM)) ++Set; else S.Errors.Add(Path + TEXT(": not saved"));
				}
			}
			if (Seen % 100 == 0) { UE_LOG(LogValdradaNanite, Display, TEXT("glassraster %d seen, %d set"), Seen, Set); CollectGarbage(RF_NoFlags); }
		}
		const FString Txt = FString::Printf(TEXT("{\"seen\": %d, \"glass\": %d, \"set\": %d, \"had\": %d, \"errors\": %d}"), Seen, Glass, Set, Had, S.Errors.Num());
		if (!OutFile.IsEmpty()) FFileHelper::SaveStringToFile(Txt, *OutFile);
		UE_LOG(LogValdradaNanite, Display, TEXT("glassraster done %s"), *Txt);
		return S.Errors.Num() ? 1 : 0;
	}
	// (-refreshvariants: every '<instance>_nan' made again from its instance: parented to the packed master of the
	// instance's master, the instance's parameters copied. The library's binding (bd_tilefac.py) had matched the copies
	// by their key and re-parented them to the unpacked master: packed facades read as garbage, pink roofs)
	if (FParse::Param(*Params, TEXT("refreshvariants")))
	{
		IAssetRegistry& AR = FModuleManager::LoadModuleChecked<FAssetRegistryModule>(TEXT("AssetRegistry")).Get();
		AR.SearchAllAssets(true);
		TArray<FAssetData> All; AR.GetAssetsByPath(FName(TEXT("/Game/MatLib")), All, true);
		int32 Seen = 0, Fixed = 0, Odd = 0; TArray<FString> OddList;
		for (const FAssetData& D : All)
		{
			if (!D.AssetName.ToString().EndsWith(TEXT("_nan"))) continue;
			++Seen;
			UMaterialInstanceConstant* V = Cast<UMaterialInstanceConstant>(D.GetAsset());
			const FString Sp = D.PackageName.ToString().LeftChop(4), Sn = D.AssetName.ToString().LeftChop(4);
			UMaterialInstanceConstant* Src = LoadObject<UMaterialInstanceConstant>(nullptr, *(Sp + TEXT(".") + Sn), nullptr, LOAD_NoWarn | LOAD_Quiet);
			UMaterial* Par = Src ? Cast<UMaterial>(Src->Parent) : nullptr;
			if (!V || !Par || !Par->GetName().StartsWith(TEXT("M_bd_tilefac_v")) || Par->GetName().EndsWith(TEXT("p")))
			{ ++Odd; if (OddList.Num() < 20) OddList.Add(D.PackageName.ToString() + TEXT(" <- ") + (Par ? Par->GetName() : FString(TEXT("none")))); continue; }
			UMaterial* Packed = PackedMaster(Par, S, true);
			if (!Packed) continue;
			V->SetParentEditorOnly(Packed);
			V->CopyMaterialUniformParametersEditorOnly(Src, false);
			V->PostEditChange(); V->MarkPackageDirty();
			if (SaveAsset(V)) ++Fixed; else S.Errors.Add(D.PackageName.ToString() + TEXT(": not saved"));
		}
		const FString Txt = FString::Printf(TEXT("{\"variants\": %d, \"fixed\": %d, \"odd\": %d, \"errors\": %d, \"odd_eg\": \"%s\"}"), Seen, Fixed, Odd, S.Errors.Num(), *FString::Join(OddList, TEXT(" | ")));
		if (!OutFile.IsEmpty()) FFileHelper::SaveStringToFile(Txt, *OutFile);
		UE_LOG(LogValdradaNanite, Display, TEXT("refreshvariants done %s"), *Txt);
		return S.Errors.Num() ? 1 : 0;
	}
	FString MasterPath;
	if (FParse::Value(*Params, TEXT("master="), MasterPath))   // (only the packed copy of one master, e.g. after a prologue fix)
	{
		UMaterial* Par = LoadObject<UMaterial>(nullptr, *MasterPath);
		UMaterial* M = Par ? PackedMaster(Par, S, true) : nullptr;
		UE_LOG(LogValdradaNanite, Display, TEXT("master %s -> %s"), *MasterPath, M ? *M->GetPathName() : TEXT("FAILED"));
		return M ? 0 : 1;
	} const double T0 = FPlatformTime::Seconds();
	int32 N = 0;
	for (const FString& Path : Paths)
	{
		if (Path.IsEmpty()) continue;
		S.Meshes++;
		UStaticMesh* SM = LoadObject<UStaticMesh>(nullptr, *Path, nullptr, LOAD_NoWarn | LOAD_Quiet);
		if (!SM) { S.SkipLoad++; continue; }
		TArray<FStaticMaterial> Mats = SM->GetStaticMaterials();
		bool bAll = Mats.Num() > 0, bAlready = Mats.Num() > 0;
		for (FStaticMaterial& Sm : Mats)
		{
			UMaterialInstanceConstant* MIC = Cast<UMaterialInstanceConstant>(Sm.MaterialInterface);
			UMaterial* Par = MIC ? Cast<UMaterial>(MIC->Parent) : nullptr;
			const FString PN = Par ? Par->GetName() : FString();
			if (!PN.StartsWith(TEXT("M_bd_tilefac_v"))) { bAll = false; bAlready = false; break; }
			if (!PN.EndsWith(TEXT("p"))) bAlready = false;
		}
		if (bAlready) { S.Already++; continue; }
		FMeshDescription* MD = SM->GetMeshDescription(0);
		if (!MD) { S.SkipLoad++; continue; }
		FStaticMeshAttributes Att(*MD);
		TVertexInstanceAttributesRef<FVector2f> UVs = Att.GetVertexInstanceUVs();
		{
			FString Pn; for (const FStaticMaterial& Sm : Mats) { const UMaterialInterface* Mi = Sm.MaterialInterface; const UMaterial* B = Mi ? Mi->GetMaterial() : nullptr; Pn += (B ? B->GetName() : FString(TEXT("none"))) + TEXT(","); }
			S.Hist.FindOrAdd(FString::Printf(TEXT("uv%d nanite%d %s"), UVs.GetNumChannels(), SM->GetNaniteSettings().bEnabled ? 1 : 0, *Pn.Left(120)))++;
		}
		if (UVs.GetNumChannels() != 8) { S.SkipUV++; continue; }
		if (!bAll) { S.SkipMat++; continue; }
		// the packed master and the instance copies
		bool bOk = true;
		for (FStaticMaterial& Sm : Mats)
		{
			UMaterialInstanceConstant* MIC = Cast<UMaterialInstanceConstant>(Sm.MaterialInterface);
			UMaterial* Packed = PackedMaster(Cast<UMaterial>(MIC->Parent), S, !bDry);
			UMaterialInstanceConstant* V = Packed ? Variant(MIC, Packed, S, !bDry) : nullptr;
			if (!V) { bOk = false; break; }
			Sm.MaterialInterface = V;
		}
		if (bVariantsOnly || bDry) continue;
		if (!bOk) { S.Errors.Add(FString::Printf(TEXT("%s: no packed material"), *Path)); continue; }
		// the vertices
		TVertexInstanceAttributesRef<FVector4f> Col = Att.GetVertexInstanceColors();
		for (const FVertexInstanceID V : MD->VertexInstances().GetElementIDs())
		{
			FVector2f U[8]; for (int32 I = 0; I < 8; ++I) U[I] = UVs.Get(V, I);
			const float Fh = U[1].X, Ww = U[1].Y, Sh = U[2].X, St = U[2].Y, Bh = U[3].X, Lit = U[3].Y, Cv = U[4].X, Fl = U[4].Y;
			auto Code = [&](float X, uint32 Base, int32 Max, bool bZero, int32 Off) -> uint32
			{
				if (bZero && X <= 0.f) return 0u;
				const int32 C = int32(HB(X)) - int32(Base) + Off;
				if (C < Off || C > Max) S.Clamped++;
				return uint32(FMath::Clamp(C, Off, Max));
			};
			const uint32 Fhc = Code(Fh, 0x3C00u, 4095, false, 0), Wwc = Code(Ww, 0x3C00u, 4095, false, 0);
			const uint32 Shc = Code(Sh, 0x3C00u, 4095, true, 1), Bhc = Code(Bh, 0x3800u, 16383, true, 1);
			const uint32 Sti = uint32(FMath::Clamp(FMath::RoundToInt(St), 0, 31)), Fli = uint32(FMath::Clamp(FMath::RoundToInt(Fl), 0, 255));
			const uint32 L8 = uint32(FMath::Clamp(FMath::RoundToInt(Lit * 255.f), 0, 255)), C8 = uint32(FMath::Clamp(FMath::RoundToInt(Cv * 255.f), 0, 255));
			const uint32 C[6] = { (HB(U[5].X) << 4) | (Sti & 15u), (HB(U[5].Y) << 4) | (Fli >> 4), (HB(U[6].X) << 4) | (Fli & 15u),
			                      (Fhc << 8) | L8, (Wwc << 8) | C8, (Shc << 8) | (Bhc >> 6) };
			float F[6];
			for (int32 I = 0; I < 6; ++I) { F[I] = DecodeUVFloat(C[I] & 0xFFFFFu); if (EncodeUVFloat(F[I]) != (C[I] & 0xFFFFFu)) S.RoundTripBad++; }
			UVs.Set(V, 1, FVector2f(F[0], F[1])); UVs.Set(V, 2, FVector2f(F[2], F[3])); UVs.Set(V, 3, FVector2f(F[4], F[5]));
			const uint32 A8 = ((Bhc & 63u) << 2) | (((Sti >> 4) & 1u) << 1);
			// (the colour as sRGB bytes: the build's ToFColor(true) gives back these bytes, the prologue linearises them)
			auto Byte = [](float L) { return SrgbToLinear(float(FMath::Clamp(FMath::RoundToInt(LinearToSrgb(L) * 255.f), 0, 255)) / 255.f); };
			Col.Set(V, FVector4f(Byte(U[6].Y), Byte(U[7].X), Byte(U[7].Y), float(A8) / 255.f));
			S.Verts++;
		}
		MD->VertexInstanceAttributes().SetAttributeChannelCount(MeshAttribute::VertexInstance::TextureCoordinate, 4);
		MD->SetNumUVChannels(4);
		SM->CommitMeshDescription(0);
		FStaticMeshSourceModel& Src = SM->GetSourceModel(0);
		Src.BuildSettings.bUseFullPrecisionUVs = true; Src.BuildSettings.bGenerateLightmapUVs = false;
		if (SM->GetLightMapCoordinateIndex() > 3) SM->SetLightMapCoordinateIndex(0);
		FMeshNaniteSettings NS = SM->GetNaniteSettings(); NS.bEnabled = !KitGlass(Mats); SM->SetNaniteSettings(NS);
		SM->SetStaticMaterials(Mats);
		SM->Build(true);
		SM->MarkPackageDirty();
		if (!SaveAsset(SM)) S.Errors.Add(FString::Printf(TEXT("%s: not saved"), *Path));
		else S.Done++;
		if (++N % 50 == 0)
		{
			UE_LOG(LogValdradaNanite, Display, TEXT("%d of %d meshes, %.0f s"), S.Meshes, Paths.Num(), FPlatformTime::Seconds() - T0);
			CollectGarbage(RF_NoFlags);
		}
	}
	TSharedRef<FJsonObject> R = MakeShared<FJsonObject>();
	R->SetNumberField(TEXT("meshes"), S.Meshes); R->SetNumberField(TEXT("done"), S.Done); R->SetNumberField(TEXT("already"), S.Already);
	R->SetNumberField(TEXT("skip_uv"), S.SkipUV); R->SetNumberField(TEXT("skip_mat"), S.SkipMat); R->SetNumberField(TEXT("skip_load"), S.SkipLoad);
	R->SetNumberField(TEXT("variants"), S.Variants); R->SetNumberField(TEXT("masters"), S.Masters); R->SetNumberField(TEXT("verts"), double(S.Verts));
	R->SetNumberField(TEXT("clamped"), double(S.Clamped)); R->SetNumberField(TEXT("roundtrip_bad"), double(S.RoundTripBad));
	R->SetNumberField(TEXT("secs"), FPlatformTime::Seconds() - T0);
	TArray<TSharedPtr<FJsonValue>> Er; for (int32 I = 0; I < FMath::Min(S.Errors.Num(), 50); ++I) Er.Add(MakeShared<FJsonValueString>(S.Errors[I]));
	R->SetArrayField(TEXT("errors"), Er);
	TSharedRef<FJsonObject> H = MakeShared<FJsonObject>(); for (auto& KV : S.Hist) H->SetNumberField(KV.Key, KV.Value); R->SetObjectField(TEXT("hist"), H);
	FString Txt; TSharedRef<TJsonWriter<>> W = TJsonWriterFactory<>::Create(&Txt); FJsonSerializer::Serialize(R, W);
	if (!OutFile.IsEmpty()) FFileHelper::SaveStringToFile(Txt, *OutFile);
	UE_LOG(LogValdradaNanite, Display, TEXT("done %s"), *Txt);
	return S.Errors.Num() ? 1 : 0;
}
