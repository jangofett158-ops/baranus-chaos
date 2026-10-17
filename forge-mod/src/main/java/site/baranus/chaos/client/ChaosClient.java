package site.baranus.chaos.client;

import com.mojang.blaze3d.platform.InputConstants;
import net.minecraft.client.KeyMapping;
import net.minecraft.client.Minecraft;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.event.TickEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;
import net.minecraftforge.fml.common.Mod;
import org.lwjgl.glfw.GLFW;
import site.baranus.chaos.BaranusChaosMod;
import site.baranus.chaos.ChaosNetwork;

@Mod.EventBusSubscriber(modid = BaranusChaosMod.MOD_ID, value = Dist.CLIENT, bus = Mod.EventBusSubscriber.Bus.FORGE)
public final class ChaosClient {
    public static final KeyMapping PANEL_KEY = new KeyMapping("key.baranuschaos.panel",
        InputConstants.Type.KEYSYM, GLFW.GLFW_KEY_K, "key.categories.baranuschaos");

    private ChaosClient() { }

    @SubscribeEvent
    public static void clientTick(TickEvent.ClientTickEvent event) {
        if (event.phase != TickEvent.Phase.END) return;
        while (PANEL_KEY.consumeClick()) {
            Minecraft minecraft = Minecraft.getInstance();
            if (minecraft.player == null || minecraft.getConnection() == null || minecraft.screen != null) continue;
            minecraft.setScreen(new ChaosMenuScreen());
            ChaosNetwork.requestMenu();
        }
    }

    public static void send(String command) {
        Minecraft minecraft = Minecraft.getInstance();
        if (minecraft.getConnection() != null) minecraft.getConnection().sendCommand(command);
    }

    public static void accept(ChaosNetwork.StatePacket packet) {
        if (Minecraft.getInstance().screen instanceof ChaosMenuScreen menu) menu.apply(packet);
    }
}
