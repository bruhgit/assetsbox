#include "AssetsboxStoreModule.h"

#include "HAL/PlatformProcess.h"
#include "ToolMenus.h"

#define LOCTEXT_NAMESPACE "FAssetsboxStoreModule"

void FAssetsboxStoreModule::StartupModule()
{
    UToolMenus::RegisterStartupCallback(
        FSimpleMulticastDelegate::FDelegate::CreateRaw(this, &FAssetsboxStoreModule::RegisterMenus));
}

void FAssetsboxStoreModule::ShutdownModule()
{
    UToolMenus::UnRegisterStartupCallback(this);
}

void FAssetsboxStoreModule::RegisterMenus()
{
    FToolMenuOwnerScoped OwnerScoped(this);
    UToolMenu* Menu = UToolMenus::Get()->ExtendMenu("LevelEditor.MainMenu.Window");
    FToolMenuSection& Section = Menu->FindOrAddSection("Assetsbox");

    Section.AddMenuEntry(
        "AssetsboxStore.Open",
        LOCTEXT("AssetsboxStoreOpenLabel", "Assetsbox Store"),
        LOCTEXT("AssetsboxStoreOpenTooltip", "Open the Assetsbox desktop asset store."),
        FSlateIcon(),
        FUIAction(FExecuteAction::CreateRaw(this, &FAssetsboxStoreModule::OpenStore)));
}

void FAssetsboxStoreModule::OpenStore()
{
    FPlatformProcess::LaunchURL(TEXT("assetsbox://store"), nullptr, nullptr);
}

#undef LOCTEXT_NAMESPACE

IMPLEMENT_MODULE(FAssetsboxStoreModule, AssetsboxStore)
