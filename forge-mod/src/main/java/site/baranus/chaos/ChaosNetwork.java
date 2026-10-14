package site.baranus.chaos;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Supplier;
import net.minecraft.network.FriendlyByteBuf;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.fml.DistExecutor;
import net.minecraftforge.network.NetworkEvent;
import net.minecraftforge.network.NetworkRegistry;
import net.minecraftforge.network.PacketDistributor;
import net.minecraftforge.network.simple.SimpleChannel;
import site.baranus.chaos.client.ChaosClient;

/** Сервер → клиент: список событий и пауза для панели K. Действия идут обычными командами OP. */
public final class ChaosNetwork {
    private static final String PROTOCOL = "2";
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
        new ResourceLocation(BaranusChaosMod.MOD_ID, "panel"), () -> PROTOCOL, PROTOCOL::equals, PROTOCOL::equals);

    private ChaosNetwork() { }

    public static void register() {
        CHANNEL.registerMessage(0, StatePacket.class, StatePacket::encode, StatePacket::decode, StatePacket::handle);
    }

    public static void sendState(ServerPlayer player) {
        if (ChaosCommands.canControl(player))
            CHANNEL.send(PacketDistributor.PLAYER.with(() -> player), StatePacket.of(player.server));
    }

    public static void broadcastState(MinecraftServer server) {
        for (ServerPlayer player : server.getPlayerList().getPlayers()) sendState(player);
    }

    public record StatePacket(boolean paused, List<Item> items) {
        public record Item(String code, String label, int color) { }

        static StatePacket of(MinecraftServer server) {
            List<Item> items = new ArrayList<>();
            ChaosEffects.EFFECTS.forEach((code, info) -> items.add(new Item(code, info.label(),
                info.color().getColor() == null ? 0xFFFFFF : info.color().getColor())));
            return new StatePacket(ChaosState.get(server).paused(), items);
        }

        static void encode(StatePacket packet, FriendlyByteBuf buf) {
            buf.writeBoolean(packet.paused);
            buf.writeVarInt(packet.items.size());
            for (Item item : packet.items) {
                buf.writeUtf(item.code(), 32);
                buf.writeUtf(item.label(), 64);
                buf.writeInt(item.color());
            }
        }

        static StatePacket decode(FriendlyByteBuf buf) {
            boolean paused = buf.readBoolean();
            int count = buf.readVarInt();
            if (count < 0 || count > 64) throw new IllegalArgumentException("Invalid Baranus Chaos packet");
            List<Item> items = new ArrayList<>();
            for (int i = 0; i < count; i++) items.add(new Item(buf.readUtf(32), buf.readUtf(64), buf.readInt()));
            return new StatePacket(paused, List.copyOf(items));
        }

        static void handle(StatePacket packet, Supplier<NetworkEvent.Context> context) {
            context.get().enqueueWork(() -> DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> ChaosClient.accept(packet)));
            context.get().setPacketHandled(true);
        }
    }
}
