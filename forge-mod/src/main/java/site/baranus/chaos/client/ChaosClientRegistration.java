package site.baranus.chaos.client;

import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.client.event.EntityRenderersEvent;
import net.minecraftforge.client.event.RegisterKeyMappingsEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import site.baranus.chaos.BaranusChaosMod;
import site.baranus.chaos.ChaosEntities;

@Mod.EventBusSubscriber(modid = BaranusChaosMod.MOD_ID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.MOD)
public final class ChaosClientRegistration {
    private ChaosClientRegistration() { }

    @SubscribeEvent
    public static void renderers(EntityRenderersEvent.RegisterRenderers event) {
        event.registerEntityRenderer(ChaosEntities.GIANT_ZOMBIE.get(), GiantZombieRenderer::new);
    }

    @SubscribeEvent
    public static void keys(RegisterKeyMappingsEvent event) {
        event.register(ChaosClient.PANEL_KEY);
    }
}
