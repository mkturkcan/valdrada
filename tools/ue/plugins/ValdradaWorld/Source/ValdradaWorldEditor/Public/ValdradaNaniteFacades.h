#pragma once
#include "CoreMinimal.h"
#include "Commandlets/Commandlet.h"
#include "ValdradaNaniteFacades.generated.h"

// The tile facades on Nanite (docs/notes/ue-persistent-city.md): a facade mesh carrying the facade master's eight UV sets
// (tools/ue/r1c_glbuv.py, tilefac) gets them packed into UV 1-3 and the vertex colour, Nanite on, and its slots pointed at
// '<instance>_nan' copies parented to the packed master ('<master>p', the same program behind a decoding prologue).
//   UnrealEditor-Cmd <project> -run=ValdradaNaniteFacades -list=<file of mesh object paths> -out=<result json> [-dry]
UCLASS()
class UValdradaNaniteFacadesCommandlet : public UCommandlet
{
	GENERATED_BODY()
public:
	virtual int32 Main(const FString& Params) override;
};
