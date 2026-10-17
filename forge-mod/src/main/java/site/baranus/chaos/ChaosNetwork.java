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

/**
 * Меню событий (клавиша K): клиент просит список, сервер присылает события с ценами и включённостью.
 * Смотреть меню может любой игрок; действия (проверка, вкл/выкл, пауза) — обычные команды OP / хозяина мира.
 */
public final class ChaosNetwork {
    private static final String PROTOCOL = "3";
    private static final SimpleChannel CHANNEL = NetworkRegistry.newSimpleChannel(
        new ResourceLocation(BaranusChaosMod.MOD_ID, "panel"), () -> PROTOCOL, PROTOCOL::equals, PROTOCOL::equals);

    private ChaosNetwork() { }

    public static void register() {
        CHANNEL.registerMessage(0, StatePacket.class, StatePacket::encode, StatePacket::decode, StatePacket::handle);
        CHANNEL.registerMessage(1, RequestPacket.class, RequestPacket::encode, RequestPacket::decode, RequestPacket::handle);
    }

    /** Клиент: запросить меню у сервера. */
    public static void requestMenu() {
        CHANNEL.sendToServer(new RequestPacket());
    }

    public static void sendState(ServerPlayer player) {
        CHANNEL.send(PacketDistributor.PLAYER.with(() -> player), StatePacket.of(player));
    }

    public static void broadcastState(MinecraftServer server) {
        for (ServerPlayer player : server.getPlayerList().getPlayers()) sendState(player);
    }

    public record RequestPacket() {
        static void encode(RequestPacket packet, FriendlyByteBuf buf) { }

        static RequestPacket decode(FriendlyByteBuf buf) { return new RequestPacket(); }

        static void handle(RequestPacket packet, Supplier<NetworkEvent.Context> context) {
            ServerPlayer sender = context.get().getSender();
            if (sender != null) context.get().enqueueWork(() -> sendState(sender));
            context.get().setPacketHandled(true);
        }
    }

    public record StatePacket(boolean paused, boolean control, boolean configured, String currency, List<Item> items) {
        public record Item(String code, String name, String desc, String category, int price, boolean enabled,
                           boolean custom, boolean all, int cooldown) { }

        static StatePacket of(ServerPlayer player) {
            MinecraftServer server = player.server;
            ChaosCatalog.Snapshot snapshot = ChaosCatalog.snapshot(server);
            List<Item> items = new ArrayList<>();
            for (ChaosCatalog.Entry entry : snapshot.entries()) {
                items.add(new Item(entry.code(), entry.name(), entry.desc(), entry.category(), entry.price(), entry.enabled(),
                    entry.custom(), entry.all(), entry.cooldown()));
            }
            return new StatePacket(ChaosState.get(server).paused(), ChaosCommands.canControl(player), snapshot.configured(),
                snapshot.currency(), List.copyOf(items));
        }

        static void encode(StatePacket packet, FriendlyByteBuf buf) {
            buf.writeBoolean(packet.paused);
            buf.writeBoolean(packet.control);
            buf.writeBoolean(packet.configured);
            buf.writeUtf(packet.currency, 8);
            buf.writeVarInt(packet.items.size());
            for (Item item : packet.items) {
                buf.writeUtf(item.code(), 32);
                buf.writeUtf(item.name(), 64);
                buf.writeUtf(item.desc(), 200);
                buf.writeUtf(item.category(), 16);
                buf.writeVarInt(Math.max(0, item.price()));
                buf.writeBoolean(item.enabled());
                buf.writeBoolean(item.custom());
                buf.writeBoolean(item.all());
                buf.writeVarInt(Math.max(0, item.cooldown()));
            }
        }

        static StatePacket decode(FriendlyByteBuf buf) {
            boolean paused = buf.readBoolean();
            boolean control = buf.readBoolean();
            boolean configured = buf.readBoolean();
            String currency = buf.readUtf(8);
            int count = buf.readVarInt();
            if (count < 0 || count > 200) throw new IllegalArgumentException("Invalid Baranus Chaos packet");
            List<Item> items = new ArrayList<>();
            for (int i = 0; i < count; i++) {
                items.add(new Item(buf.readUtf(32), buf.readUtf(64), buf.readUtf(200), buf.readUtf(16), buf.readVarInt(),
                    buf.readBoolean(), buf.readBoolean(), buf.readBoolean(), buf.readVarInt()));
            }
            return new StatePacket(paused, control, configured, currency, List.copyOf(items));
        }

        static void handle(StatePacket packet, Supplier<NetworkEvent.Context> context) {
            context.get().enqueueWork(() -> DistExecutor.unsafeRunWhenOn(Dist.CLIENT, () -> () -> ChaosClient.accept(packet)));
            context.get().setPacketHandled(true);
        }
    }
}
