package site.baranus.chaos;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import java.util.List;
import net.minecraft.ChatFormatting;
import net.minecraft.commands.CommandSource;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.commands.SharedSuggestionProvider;
import net.minecraft.commands.arguments.EntityArgument;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.Entity;

/**
 * Команды только для OP (уровень 2). Приложение ходит через RCON и получает машинные ответы
 * «BaranusChaos:...»; игрок с панели K видит понятный текст.
 */
public final class ChaosCommands {
    private static final SuggestionProvider<CommandSourceStack> EFFECTS =
        (context, builder) -> SharedSuggestionProvider.suggest(ChaosEffects.CODES, builder);

    private ChaosCommands() { }

    public static void register(CommandDispatcher<CommandSourceStack> dispatcher) {
        dispatcher.register(Commands.literal("baranuschaos")
            .requires(ChaosCommands::allowed)
            .then(Commands.literal("status").executes(context -> status(context.getSource())))
            .then(Commands.literal("list").executes(context ->
                reply(context.getSource(), "BaranusChaos:EFFECTS " + String.join(",", ChaosEffects.CODES), "События: " + String.join(", ", ChaosEffects.CODES))))
            .then(Commands.literal("pause").executes(context -> setPaused(context.getSource(), true)))
            .then(Commands.literal("resume").executes(context -> setPaused(context.getSource(), false)))
            .then(Commands.literal("panel").executes(context -> panel(context.getSource())))
            .then(Commands.literal("cleanup")
                .then(Commands.argument("target", EntityArgument.player())
                    .executes(context -> cleanup(context.getSource(), EntityArgument.getPlayer(context, "target")))))
            .then(effectCommand("trigger", false))
            .then(effectCommand("test", true))
            .then(customCommand("custom", false))
            .then(customCommand("customtest", true)));
    }

    /**
     * Своё событие из приложения: одна команда Minecraft от имени игрока (уровень прав 2 — без /op, /stop и т. п.).
     * Аргументы в base64url: подпись («-» — без заголовка), ник зрителя, сама команда.
     */
    private static LiteralArgumentBuilder<CommandSourceStack> customCommand(String name, boolean test) {
        return Commands.literal(name)
            .then(Commands.argument("target", EntityArgument.player())
                .then(Commands.argument("label", StringArgumentType.word())
                    .then(Commands.argument("donor", StringArgumentType.word())
                        .then(Commands.argument("command", StringArgumentType.word())
                            .executes(context -> runCustom(context.getSource(), EntityArgument.getPlayer(context, "target"),
                                StringArgumentType.getString(context, "label"), StringArgumentType.getString(context, "donor"),
                                StringArgumentType.getString(context, "command"), test))))));
    }

    private static int runCustom(CommandSourceStack source, ServerPlayer target, String labelToken, String donorToken, String commandToken, boolean test) {
        if (!test && ChaosState.get(source.getServer()).paused()) {
            source.sendFailure(Component.literal("BaranusChaos:PAUSED"));
            return 0;
        }
        String command = ChaosEffects.decodeText(commandToken, 1000);
        if (command == null || command.isBlank() || command.contains("\n")) return error(source, "bad-command");
        if (command.startsWith("/")) command = command.substring(1);
        String donor = ChaosEffects.decodeDonor(donorToken, test ? "Тест" : "Зритель");
        command = command.replace("{player}", target.getGameProfile().getName()).replace("{donor}", donor);
        StringBuilder output = new StringBuilder();
        CommandSource collector = new CommandSource() {
            @Override public void sendSystemMessage(Component message) { output.append(message.getString()).append(' '); }
            @Override public boolean acceptsSuccess() { return true; }
            @Override public boolean acceptsFailure() { return true; }
            @Override public boolean shouldInformAdmins() { return false; }
        };
        CommandSourceStack stack = new CommandSourceStack(collector, target.position(), target.getRotationVector(), target.serverLevel(),
            2, target.getName().getString(), target.getDisplayName(), source.getServer(), target);
        int result = source.getServer().getCommands().performPrefixedCommand(stack, command);
        if (result <= 0) {
            String details = output.toString().trim().replaceAll("\\s+", " ");
            source.sendFailure(Component.literal("BaranusChaos:ERROR command " + (details.isEmpty() ? "-" : details)));
            return 0;
        }
        if (!"-".equals(labelToken)) {
            String label = ChaosEffects.decodeText(labelToken, 48);
            if (label != null && !label.isBlank()) ChaosEffects.announce(target, new ChaosEffects.Info(label.replace("§", ""), ChatFormatting.RED), donor);
        }
        return reply(source, "BaranusChaos:OK custom " + target.getGameProfile().getName(), "Своё событие выполнено");
    }

    /** OP уровня 2 или хозяин одиночного мира (даже без включённых читов). */
    public static boolean allowed(CommandSourceStack source) {
        return source.hasPermission(2) || (source.getEntity() instanceof ServerPlayer player && canControl(player));
    }

    public static boolean canControl(ServerPlayer player) {
        return player.hasPermissions(2) || player.server.isSingleplayerOwner(player.getGameProfile());
    }

    /** trigger — донат (учитывает паузу), test — проверка стримером (без учёта паузы). */
    private static LiteralArgumentBuilder<CommandSourceStack> effectCommand(String name, boolean test) {
        return Commands.literal(name)
            .then(Commands.argument("effect", StringArgumentType.word()).suggests(EFFECTS)
                .then(Commands.argument("target", EntityArgument.player())
                    .executes(context -> run(context.getSource(), StringArgumentType.getString(context, "effect"),
                        EntityArgument.getPlayer(context, "target"), null, test))
                    .then(Commands.argument("donor", StringArgumentType.word())
                        .executes(context -> run(context.getSource(), StringArgumentType.getString(context, "effect"),
                            EntityArgument.getPlayer(context, "target"), StringArgumentType.getString(context, "donor"), test)))));
    }

    private static int run(CommandSourceStack source, String effect, ServerPlayer target, String donorToken, boolean test) {
        if (!ChaosEffects.EFFECTS.containsKey(effect)) return error(source, "unknown");
        if (!test && ChaosState.get(source.getServer()).paused()) {
            source.sendFailure(Component.literal("BaranusChaos:PAUSED"));
            return 0;
        }
        String donor = ChaosEffects.decodeDonor(donorToken, test ? "Тест" : "Зритель");
        try {
            ChaosEffects.execute(effect, target, donor);
        } catch (ChaosEffects.ChaosException error) {
            return error(source, error.getMessage());
        } catch (RuntimeException error) {
            BaranusChaosMod.LOGGER.error("Baranus Chaos: effect {} failed", effect, error);
            return error(source, "failed");
        }
        return reply(source, "BaranusChaos:OK " + effect + " " + target.getGameProfile().getName(),
            "Событие «" + ChaosEffects.EFFECTS.get(effect).label() + "» запущено");
    }

    private static int status(CommandSourceStack source) {
        MinecraftServer server = source.getServer();
        String[] names = server.getPlayerNames();
        String players = names.length == 0 ? "-" : String.join(",", names);
        boolean paused = ChaosState.get(server).paused();
        return reply(source, "BaranusChaos:STATUS " + BaranusChaosMod.VERSION + " " + (paused ? 1 : 0) + " " + players,
            "Baranus Chaos " + BaranusChaosMod.VERSION + (paused ? " — на паузе" : " — активен"));
    }

    private static int setPaused(CommandSourceStack source, boolean paused) {
        ChaosState.get(source.getServer()).setPaused(paused);
        ChaosNetwork.broadcastState(source.getServer());
        return reply(source, "BaranusChaos:PAUSE " + (paused ? 1 : 0), paused ? "Хаос на паузе" : "Хаос снова активен");
    }

    private static int panel(CommandSourceStack source) {
        if (source.getEntity() instanceof ServerPlayer player) {
            ChaosNetwork.sendState(player);
            return 1;
        }
        source.sendFailure(Component.literal("BaranusChaos:ERROR panel-requires-player"));
        return 0;
    }

    private static int cleanup(CommandSourceStack source, ServerPlayer target) {
        List<Entity> entities = target.serverLevel().getEntities((Entity) null, target.getBoundingBox().inflate(128.0D),
            entity -> entity.getTags().contains(ChaosEffects.CHAOS_TAG) || entity.getTags().contains(ChaosEffects.FAKE_TNT_TAG));
        entities.forEach(Entity::discard);
        return reply(source, "BaranusChaos:CLEANED " + entities.size(), "Убрано существ хаоса: " + entities.size());
    }

    private static int error(CommandSourceStack source, String code) {
        source.sendFailure(Component.literal("BaranusChaos:ERROR " + code));
        return 0;
    }

    private static int reply(CommandSourceStack source, String machine, String human) {
        boolean player = source.getEntity() instanceof ServerPlayer;
        source.sendSuccess(() -> Component.literal(player ? human : machine), false);
        return 1;
    }
}
