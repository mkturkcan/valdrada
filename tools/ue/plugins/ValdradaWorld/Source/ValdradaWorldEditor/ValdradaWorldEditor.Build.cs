using UnrealBuildTool;
public class ValdradaWorldEditor : ModuleRules
{
	public ValdradaWorldEditor(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "UnrealEd", "MeshDescription", "StaticMeshDescription", "AssetRegistry", "Json" });
	}
}
