package site.baranus.chaos;

import com.mojang.logging.LogUtils;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import org.slf4j.Logger;

@Mod(BaranusChaosMod.MOD_ID)
public final class BaranusChaosMod {
    public static final String MOD_ID = "baranuschaos";
    public static final String VERSION = "1.5.1";
    public static final Logger LOGGER = LogUtils.getLogger();

    public BaranusChaosMod() {
        ChaosNetwork.register();
        MinecraftForge.EVENT_BUS.register(new ChaosEvents());
    }
}
