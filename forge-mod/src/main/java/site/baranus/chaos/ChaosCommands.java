package site.baranus.chaos;

import com.mojang.brigadier.CommandDispatcher;
import com.mojang.brigadier.arguments.IntegerArgumentType;
import com.mojang.brigadier.arguments.StringArgumentType;
import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import com.mojang.brigadier.context.CommandContext;
import com.mojang.brigadier.exceptions.CommandSyntaxException;
import com.mojang.brigadier.suggestion.SuggestionProvider;
import java.util.ArrayList;
import java.util.Collection;
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
 * Команды только для OP (уровень 2) и хозяина одиночного мира. Приложение получает машинные ответы
 * «BaranusChaos:...»; игрок с панели K видит понятный текст.
 */
public final class ChaosCommands {
    private static final SuggestionProvider<CommandSourceStack> EFFECTS =
        (context, builder) -> SharedSuggestionProvider.suggest(ChaosEffects.CODES, builder);
    private static final int CHUNK = 1000;

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
            .then(customCommand("customtest", true))
            .then(Commands.literal("claim")
                .then(Commands.argument("code", StringArgumentType.word())
                    .then(Commands.argument("gap", IntegerArgumentType.integer(0, 3600))
                        .then(Commands.argument("cooldown", IntegerArgumentType.integer(0, 86400))
                            .executes(ChaosCommands::claim)))))
            .then(Commands.literal("sync")
                .then(Commands.literal("get").executes(context -> syncGet(context.getSource())))
                .then(Commands.literal("chunk")
                    .then(Commands.argument("index", IntegerArgumentType.integer(0, 255))
                        .executes(context -> syncChunk(context.getSource(), IntegerArgumentType.getInteger(context, "index")))))
                .then(Commands.literal("put")
                    .then(Commands.argument("upload", StringArgumentType.word())
                        .then(Commands.argument("index", IntegerArgumentType.integer(0, 255))
                            .then(Commands.argument("total", IntegerArgumentType.integer(1, 256))
                                .then(Commands.argument("data", StringArgumentType.word())
                                    .executes(ChaosCommands::syncPut)))))))
            .then(Commands.literal("remote")
                .executes(context -> remote(context.getSource(), null))
                .then(Commands.literal("on").executes(context -> remote(context.getSource(), true)))
                .then(Commands.literal("off").executes(context -> remote(context.getSource(), false)))));
    }

    /** OP уровня 2 или хозяин одиночного мира (даже без включённых читов). */
    public static boolean allowed(CommandSourceStack source) {
        return source.hasPermission(2) || (source.getEntity() instanceof ServerPlayer player && canControl(player));
    }

    public static boolean canControl(ServerPlayer player) {
        return player.hasPermissions(2) || player.server.isSingleplayerOwner(player.getGameProfile());
    }

    // ---------- Встроенные события ----------

    /**
     * trigger — донат (учитывает паузу), test — проверка стримером (без учёта паузы).
     * Цель — ник или @a (все игроки). Необязательно: ник зрителя (base64url), количество, секунды, уровень.
     */
    private static LiteralArgumentBuilder<CommandSourceStack> effectCommand(String name, boolean test) {
        return Commands.literal(name)
            .then(Commands.argument("effect", StringArgumentType.word()).suggests(EFFECTS)
                .then(Commands.argument("targets", EntityArgument.players())
                    .executes(context -> run(context, null, ChaosEffects.Params.DEFAULT, test))
                    .then(Commands.argument("donor", StringArgumentType.word())
                        .executes(context -> run(context, StringArgumentType.getString(context, "donor"), ChaosEffects.Params.DEFAULT, test))
                        .then(Commands.argument("count", IntegerArgumentType.integer(0, 64))
                            .then(Commands.argument("seconds", IntegerArgumentType.integer(0, 3600))
                                .then(Commands.argument("level", IntegerArgumentType.integer(0, 10))
                                    .executes(context -> run(context, StringArgumentType.getString(context, "donor"),
                                        new ChaosEffects.Params(IntegerArgumentType.getInteger(context, "count"),
                                            IntegerArgumentType.getInteger(context, "seconds"),
                                            IntegerArgumentType.getInteger(context, "level")), test))))))));
    }

    private static int run(CommandContext<CommandSourceStack> context, String donorToken, ChaosEffects.Params params, boolean test)
        throws CommandSyntaxException {
        CommandSourceStack source = context.getSource();
        String effect = StringArgumentType.getString(context, "effect");
        Collection<ServerPlayer> targets = EntityArgument.getPlayers(context, "targets");
        if (!ChaosEffects.EFFECTS.containsKey(effect)) return error(source, "unknown");
        if (!test && ChaosState.get(source.getServer()).paused()) {
            source.sendFailure(Component.literal("BaranusChaos:PAUSED"));
            return 0;
        }
        String donor = ChaosEffects.decodeDonor(donorToken, test ? "Тест" : "Зритель");
        List<String> done = new ArrayList<>();
        String firstError = null;
        for (ServerPlayer target : targets) {
            try {
                ChaosEffects.execute(effect, target, donor, params);
                done.add(target.getGameProfile().getName());
            } catch (ChaosEffects.ChaosException error) {
                if (firstError == null) firstError = error.getMessage();
            } catch (RuntimeException error) {
                BaranusChaosMod.LOGGER.error("Baranus Chaos: effect {} failed", effect, error);
                if (firstError == null) firstError = "failed";
            }
        }
        if (done.isEmpty()) return error(source, firstError == null ? "failed" : firstError);
        ChaosEffects.announceAll(source.getServer(), ChaosEffects.EFFECTS.get(effect), donor);
        return reply(source, "BaranusChaos:OK " + effect + " " + String.join(",", done),
            "Событие «" + ChaosEffects.EFFECTS.get(effect).label() + "» запущено");
    }

    // ---------- Свои события ----------

    /**
     * Своё событие из приложения: одна команда Minecraft от имени каждого игрока-цели (уровень прав 2 — без /op, /stop).
     * Аргументы в base64url: подпись («-» — без надписи), ник зрителя, сама команда.
     */
    private static LiteralArgumentBuilder<CommandSourceStack> customCommand(String name, boolean test) {
        return Commands.literal(name)
            .then(Commands.argument("targets", EntityArgument.players())
                .then(Commands.argument("label", StringArgumentType.word())
                    .then(Commands.argument("donor", StringArgumentType.word())
                        .then(Commands.argument("command", StringArgumentType.word())
                            .executes(context -> runCustom(context, test))))));
    }

    private static int runCustom(CommandContext<CommandSourceStack> context, boolean test) throws CommandSyntaxException {
        CommandSourceStack source = context.getSource();
        Collection<ServerPlayer> targets = EntityArgument.getPlayers(context, "targets");
        String labelToken = StringArgumentType.getString(context, "label");
        if (!test && ChaosState.get(source.getServer()).paused()) {
            source.sendFailure(Component.literal("BaranusChaos:PAUSED"));
            return 0;
        }
        String template = ChaosEffects.decodeText(StringArgumentType.getString(context, "command"), 1000);
        if (template == null || template.isBlank() || template.contains("\n")) return error(source, "bad-command");
        if (template.startsWith("/")) template = template.substring(1);
        String donor = ChaosEffects.decodeDonor(StringArgumentType.getString(context, "donor"), test ? "Тест" : "Зритель");
        String failure = null;
        int ok = 0;
        for (ServerPlayer target : targets) {
            String command = template.replace("{player}", target.getGameProfile().getName()).replace("{donor}", donor);
            StringBuilder output = new StringBuilder();
            CommandSource collector = new CommandSource() {
                @Override public void sendSystemMessage(Component message) { output.append(message.getString()).append(' '); }
                @Override public boolean acceptsSuccess() { return true; }
                @Override public boolean acceptsFailure() { return true; }
                @Override public boolean shouldInformAdmins() { return false; }
            };
            CommandSourceStack stack = new CommandSourceStack(collector, target.position(), target.getRotationVector(), target.serverLevel(),
                2, target.getName().getString(), target.getDisplayName(), source.getServer(), target);
            if (source.getServer().getCommands().performPrefixedCommand(stack, command) > 0) ok++;
            else if (failure == null) failure = output.toString().trim().replaceAll("\\s+", " ");
        }
        if (ok == 0) {
            source.sendFailure(Component.literal("BaranusChaos:ERROR command " + (failure == null || failure.isEmpty() ? "-" : failure)));
            return 0;
        }
        if (!"-".equals(labelToken)) {
            String label = ChaosEffects.decodeText(labelToken, 48);
            if (label != null && !label.isBlank())
                ChaosEffects.announceAll(source.getServer(), new ChaosEffects.Info(label.replace("§", ""), ChatFormatting.RED), donor);
        }
        return reply(source, "BaranusChaos:OK custom " + ok, "Своё событие выполнено");
    }

    // ---------- Очередь, синхронизация, доступ друга ----------

    /** Общая очередь всех приложений: пауза между событиями и перезарядка. Ответ: CLAIM ok или CLAIM wait <мс>. */
    private static int claim(CommandContext<CommandSourceStack> context) {
        long wait = ChaosState.get(context.getSource().getServer()).claim(StringArgumentType.getString(context, "code"),
            IntegerArgumentType.getInteger(context, "gap"), IntegerArgumentType.getInteger(context, "cooldown"));
        return reply(context.getSource(), wait == 0 ? "BaranusChaos:CLAIM ok" : "BaranusChaos:CLAIM wait " + wait,
            wait == 0 ? "Можно запускать" : "Подождите " + (wait / 1000 + 1) + " с");
    }

    private static int syncGet(CommandSourceStack source) {
        ChaosState state = ChaosState.get(source.getServer());
        int chunks = (state.config().length() + CHUNK - 1) / CHUNK;
        return reply(source, "BaranusChaos:SYNC " + state.revision() + " " + chunks, "Ревизия настроек: " + state.revision());
    }

    private static int syncChunk(CommandSourceStack source, int index) {
        String config = ChaosState.get(source.getServer()).config();
        int from = index * CHUNK;
        if (from >= config.length()) return error(source, "no-chunk");
        return reply(source, "BaranusChaos:CHUNK " + index + " " + config.substring(from, Math.min(config.length(), from + CHUNK)), "Часть " + index);
    }

    private static int syncPut(CommandContext<CommandSourceStack> context) {
        CommandSourceStack source = context.getSource();
        try {
            int revision = ChaosState.get(source.getServer()).putPart(StringArgumentType.getString(context, "upload"),
                IntegerArgumentType.getInteger(context, "index"), IntegerArgumentType.getInteger(context, "total"),
                StringArgumentType.getString(context, "data"));
            return revision < 0
                ? reply(source, "BaranusChaos:PART " + IntegerArgumentType.getInteger(context, "index"), "Часть принята")
                : reply(source, "BaranusChaos:SYNCED " + revision, "Настройки сохранены");
        } catch (IllegalArgumentException error) {
            return error(source, error.getMessage());
        }
    }

    private static int remote(CommandSourceStack source, Boolean enable) {
        ChaosState state = ChaosState.get(source.getServer());
        if (enable != null && enable != state.remote()) {
            state.setRemote(enable);
            LocalBridge.start(source.getServer());
        }
        return reply(source, "BaranusChaos:REMOTE " + (state.remote() ? 1 : 0) + " " + state.accessCode(),
            state.remote() ? "Друг может подключаться, код: " + state.accessCode() : "Подключение друга выключено");
    }

    // ---------- Служебное ----------

    private static int status(CommandSourceStack source) {
        MinecraftServer server = source.getServer();
        ChaosState state = ChaosState.get(server);
        String[] names = server.getPlayerNames();
        String players = names.length == 0 ? "-" : String.join(",", names);
        return reply(source, "BaranusChaos:STATUS " + BaranusChaosMod.VERSION + " " + (state.paused() ? 1 : 0) + " " + players
                + " " + state.revision() + " " + (state.remote() ? 1 : 0),
            "Baranus Chaos " + BaranusChaosMod.VERSION + (state.paused() ? " — на паузе" : " — активен"));
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
