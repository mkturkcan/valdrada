using UnrealBuildTool;
public class ValdradaWorld : ModuleRules
{
	public ValdradaWorld(ReadOnlyTargetRules Target) : base(Target)
	{
		PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;
		PublicDependencyModuleNames.AddRange(new string[] { "Core", "CoreUObject", "Engine", "MovieRenderPipelineCore", "LevelSequence", "MovieScene", "Json" });
	}
}
