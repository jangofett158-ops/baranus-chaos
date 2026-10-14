package site.baranus.chaos;

import com.mojang.logging.LogUtils;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.event.entity.EntityAttributeCreationEvent;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;
import site.baranus.chaos.entity.GiantZombie;

@Mod(BaranusChaosMod.MOD_ID)
public final class BaranusChaosMod {
    public static final String MOD_ID = "baranuschaos";
    public static final String VERSION = "1.2.0";
    public static final Logger LOGGER = LogUtils.getLogger();

    public BaranusChaosMod() {
        IEventBus modBus = FMLJavaModLoadingContext.get().getModEventBus();
        ChaosEntities.TYPES.register(modBus);
        modBus.addListener(BaranusChaosMod::attributes);
        ChaosNetwork.register();
        MinecraftForge.EVENT_BUS.register(new ChaosEvents());
    }

    private static void attributes(EntityAttributeCreationEvent event) {
        event.put(ChaosEntities.GIANT_ZOMBIE.get(), GiantZombie.createAttributes().build());
    }
}
