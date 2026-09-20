#pragma once

#include "Modules/ModuleManager.h"

class FAssetsboxStoreModule final : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;

private:
    void RegisterMenus();
    void OpenStore();
};
