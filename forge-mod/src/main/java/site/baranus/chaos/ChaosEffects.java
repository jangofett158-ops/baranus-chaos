package site.baranus.chaos;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import net.minecraft.ChatFormatting;
import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.network.chat.Component;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.util.RandomSource;
import net.minecraft.world.Difficulty;
import net.minecraft.world.effect.MobEffect;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.entity.Entity;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.LightningBolt;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.MobSpawnType;
import net.minecraft.world.entity.animal.IronGolem;
import net.minecraft.world.entity.animal.Wolf;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.Items;
import net.minecraft.world.phys.Vec3;

/**
 * Все события Baranus Chaos. Код события совпадает с каталогом приложения (lib/catalog.mjs).
 * Текст зрителя никогда не выполняется как команда: ник только отображается.
 */
public final class ChaosEffects {
    public static final String CHAOS_TAG = "baranus_chaos";
    public static final String FAKE_TNT_TAG = "baranus_fake_tnt";

    public record Info(String label, ChatFormatting color) { }

    private static final ChatFormatting HELP = ChatFormatting.GREEN;
    private static final ChatFormatting PRANK = ChatFormatting.GOLD;
    private static final ChatFormatting MOBS = ChatFormatting.RED;
    private static final ChatFormatting CHAOS = ChatFormatting.LIGHT_PURPLE;

    public static final Map<String, Info> EFFECTS = new LinkedHashMap<>();
    static {
        add("heal", "Исцеление", HELP);
        add("food", "Сытный обед", HELP);
        add("speed", "Скорость", HELP);
        add("buff", "Мощь", HELP);
        add("gift", "Подарок", HELP);
        add("diamond", "Алмазы", HELP);
        add("wolf", "Пёс-защитник", HELP);
        add("golem", "Железный голем", HELP);
        add("blind", "Слепота", PRANK);
        add("drunk", "Головокружение", PRANK);
        add("darkness", "Темнота", PRANK);
        add("freeze", "Заморозка", PRANK);
        add("launch", "В небо!", PRANK);
        add("drop", "Выронить предмет", PRANK);
        add("hotbar", "Перемешать хотбар", PRANK);
        add("pig", "Свинка", MOBS);
        add("zombie", "Зомби", MOBS);
        add("skeleton", "Скелет", MOBS);
        add("creeper", "Крипер", MOBS);
        add("chickenrain", "Куриный дождь", CHAOS);
        add("lightning", "Молния", CHAOS);
        add("faketnt", "TNT?!", CHAOS);
        add("night", "Ночь", CHAOS);
        add("storm", "Гроза", CHAOS);
    }
    public static final List<String> CODES = List.copyOf(EFFECTS.keySet());

    private static void add(String code, String label, ChatFormatting color) {
        EFFECTS.put(code, new Info(label, color));
    }

    /** Ошибка с коротким машинным кодом для приложения: BaranusChaos:ERROR <код>. */
    public static final class ChaosException extends RuntimeException {
        public ChaosException(String code) { super(code); }
    }

    private ChaosEffects() { }

    public static String decodeDonor(String token, String fallback) {
        if (token == null || token.isEmpty()) return fallback;
        try {
            return cleanDonor(new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8), fallback);
        } catch (IllegalArgumentException error) {
            return fallback;
        }
    }

    /** Ник зрителя для показа: только буквы, цифры и « _.-», не длиннее 24 символов. */
    public static String cleanDonor(String raw, String fallback) {
        if (raw == null) return fallback;
        String clean = raw.replaceAll("[^\\p{L}\\p{N} _.\\-]", "").replaceAll("\\s+", " ").trim();
        if (clean.length() > 24) clean = clean.substring(0, 24);
        return clean.isEmpty() ? fallback : clean;
    }

    /** Текст из base64url (подпись или команда своего события); null — если не декодируется или слишком длинный. */
    public static String decodeText(String token, int maxLength) {
        try {
            String text = new String(Base64.getUrlDecoder().decode(token), StandardCharsets.UTF_8);
            return text.length() > maxLength ? null : text.replaceAll("[\\p{Cntrl}&&[^\\n]]", "");
        } catch (IllegalArgumentException error) {
            return null;
        }
    }

    /** Настройки события из приложения: количество, длительность (сек) и уровень. 0 — значение по умолчанию. */
    public record Params(int count, int seconds, int level) {
        public static final Params DEFAULT = new Params(0, 0, 0);
        int count(int fallback) { return count > 0 ? Math.min(count, 64) : fallback; }
        int seconds(int fallback) { return seconds > 0 ? Math.min(seconds, 3600) : fallback; }
        int level(int fallback) { return level > 0 ? Math.min(level, 10) : fallback; }
    }

    /** Выполнить событие для одного игрока. Надписей и сообщений в чате мод не показывает. */
    public static void execute(String code, ServerPlayer player, String donor, Params p) {
        Info info = EFFECTS.get(code);
        if (info == null) throw new ChaosException("unknown");
        if (player.isSpectator()) throw new ChaosException("spectator");
        if (!player.isAlive()) throw new ChaosException("dead");
        ServerLevel level = player.serverLevel();
        ServerLevel overworld = player.server.overworld();
        switch (code) {
            case "heal" -> { player.setHealth(player.getMaxHealth()); player.clearFire(); }
            case "food" -> player.getFoodData().eat(20, 1.0F);
            case "speed" -> effect(player, MobEffects.MOVEMENT_SPEED, p.seconds(30), p.level(2) - 1);
            case "buff" -> {
                effect(player, MobEffects.DAMAGE_BOOST, p.seconds(30), p.level(1) - 1);
                effect(player, MobEffects.DAMAGE_RESISTANCE, p.seconds(30), p.level(1) - 1);
            }
            case "gift" -> { for (int i = 0; i < p.count(1); i++) give(player, randomGift(player.getRandom())); }
            case "diamond" -> give(player, new ItemStack(Items.DIAMOND, p.count(2)));
            case "wolf" -> {
                for (int i = 0; i < p.count(1); i++) {
                    Wolf wolf = spawnNear(EntityType.WOLF, level, player, donor, 2, 4, false, false);
                    wolf.tame(player);
                    wolf.setOrderedToSit(false);
                }
            }
            case "golem" -> { for (int i = 0; i < p.count(1); i++) spawnNear(EntityType.IRON_GOLEM, level, player, donor, 3, 5, false, false).setPlayerCreated(true); }
            case "blind" -> effect(player, MobEffects.BLINDNESS, p.seconds(10), 0);
            case "drunk" -> effect(player, MobEffects.CONFUSION, p.seconds(15), 0);
            case "darkness" -> effect(player, MobEffects.DARKNESS, p.seconds(15), 0);
            case "freeze" -> { effect(player, MobEffects.MOVEMENT_SLOWDOWN, p.seconds(8), 6); effect(player, MobEffects.DIG_SLOWDOWN, p.seconds(8), 3); }
            case "launch" -> {
                Vec3 motion = player.getDeltaMovement();
                player.setDeltaMovement(motion.x, 0.6D + 0.4D * p.level(2), motion.z);
                player.hurtMarked = true;
                effect(player, MobEffects.SLOW_FALLING, 6 + 2 * p.level(2), 0);
            }
            case "drop" -> dropHeld(player);
            case "hotbar" -> shuffleHotbar(player);
            case "pig" -> { for (int i = 0; i < p.count(1); i++) spawnNear(EntityType.PIG, level, player, donor, 2, 3, false, false); }
            case "zombie" -> { requireHostile(level); for (int i = 0; i < p.count(1); i++) spawnNear(EntityType.ZOMBIE, level, player, donor, 3, 5, true, true); }
            case "skeleton" -> { requireHostile(level); for (int i = 0; i < p.count(1); i++) spawnNear(EntityType.SKELETON, level, player, donor, 5, 8, true, true); }
            case "creeper" -> { requireHostile(level); for (int i = 0; i < p.count(1); i++) spawnNear(EntityType.CREEPER, level, player, donor, 3, 5, false, true); }
            case "chickenrain" -> chickenRain(level, player, p.count(8));
            case "lightning" -> { for (int i = 0; i < p.count(1); i++) lightning(level, player); }
            case "faketnt" -> { for (int i = 0; i < p.count(1); i++) fakeTnt(level, player, donor); }
            case "night" -> {
                long time = overworld.getDayTime();
                long night = time - Math.floorMod(time, 24000L) + 13000L;
                overworld.setDayTime(night <= time ? night + 24000L : night);
            }
            case "storm" -> overworld.setWeatherParameters(0, 20 * p.seconds(120), true, true);
            default -> throw new ChaosException("unknown");
        }
    }

    /**
     * Есть ли рядом с игроком место для моба: свободный куб 3×3×3 (без твёрдых блоков) в пределах 6 блоков
     * по горизонтали и 3 по высоте. В узкой шахте его нет - ивент с мобами ждёт в очереди.
     */
    public static boolean hasRoom(ServerPlayer player) {
        ServerLevel level = player.serverLevel();
        BlockPos base = player.blockPosition();
        for (int dy = -3; dy <= 3; dy++)
            for (int dx = -6; dx <= 6; dx++)
                for (int dz = -6; dz <= 6; dz++)
                    if (freeCube(level, base.offset(dx, dy, dz))) return true;
        return false;
    }

    private static boolean freeCube(ServerLevel level, BlockPos bottom) {
        for (int y = 0; y <= 2; y++)
            for (int x = -1; x <= 1; x++)
                for (int z = -1; z <= 1; z++) {
                    BlockPos pos = bottom.offset(x, y, z);
                    if (!level.isLoaded(pos) || !level.getBlockState(pos).getCollisionShape(level, pos).isEmpty()) return false;
                }
        return true;
    }

    private static void requireHostile(ServerLevel level) {
        if (level.getDifficulty() == Difficulty.PEACEFUL) throw new ChaosException("peaceful");
    }

    private static void effect(ServerPlayer player, MobEffect effect, int seconds, int amplifier) {
        player.addEffect(new MobEffectInstance(effect, seconds * 20, amplifier));
    }

    private static void give(ServerPlayer player, ItemStack stack) {
        if (!player.getInventory().add(stack) && !stack.isEmpty()) player.drop(stack, false);
    }

    private static ItemStack randomGift(RandomSource random) {
        return switch (random.nextInt(8)) {
            case 0 -> new ItemStack(Items.GOLDEN_APPLE, 2);
            case 1 -> new ItemStack(Items.ENDER_PEARL, 4);
            case 2 -> new ItemStack(Items.IRON_INGOT, 12);
            case 3 -> new ItemStack(Items.COOKED_BEEF, 16);
            case 4 -> new ItemStack(Items.ARROW, 32);
            case 5 -> new ItemStack(Items.EMERALD, 6);
            case 6 -> new ItemStack(Items.EXPERIENCE_BOTTLE, 12);
            default -> new ItemStack(Items.GOLD_INGOT, 8);
        };
    }

    private static void dropHeld(ServerPlayer player) {
        Inventory inventory = player.getInventory();
        int slot = inventory.selected;
        for (int i = 0; i < 9 && inventory.getItem(slot).isEmpty(); i++) slot = i;
        ItemStack stack = inventory.getItem(slot);
        if (stack.isEmpty()) return; // нечего ронять — событие всё равно засчитано
        inventory.setItem(slot, ItemStack.EMPTY);
        player.drop(stack, false, true);
    }

    private static void shuffleHotbar(ServerPlayer player) {
        Inventory inventory = player.getInventory();
        List<ItemStack> items = new ArrayList<>();
        for (int i = 0; i < 9; i++) items.add(inventory.getItem(i));
        Collections.shuffle(items, new Random(player.getRandom().nextLong()));
        for (int i = 0; i < 9; i++) inventory.setItem(i, items.get(i));
    }

    private static void name(Entity entity, String donor) {
        entity.setCustomName(Component.literal(donor).withStyle(ChatFormatting.RED));
        entity.setCustomNameVisible(true);
    }

    /** Ищет свободное место рядом с игроком только в уже загруженных чанках. */
    private static boolean place(Entity entity, ServerLevel level, ServerPlayer player, double minRadius, double maxRadius) {
        RandomSource random = player.getRandom();
        for (int attempt = 0; attempt < 20; attempt++) {
            double angle = random.nextDouble() * Math.PI * 2;
            double radius = minRadius + random.nextDouble() * (maxRadius - minRadius);
            double x = player.getX() + Math.cos(angle) * radius;
            double z = player.getZ() + Math.sin(angle) * radius;
            for (int dy : new int[] {0, 1, -1, 2, -2}) {
                BlockPos pos = BlockPos.containing(x, Math.floor(player.getY()) + dy, z);
                if (!level.hasChunkAt(pos)) continue;
                entity.moveTo(x, pos.getY(), z, random.nextFloat() * 360.0F, 0.0F);
                if (level.noCollision(entity) && !level.containsAnyLiquid(entity.getBoundingBox())
                    && level.getBlockState(pos.below()).isFaceSturdy(level, pos.below(), Direction.UP)) return true;
            }
        }
        entity.moveTo(player.getX(), player.getY(), player.getZ(), player.getYRot(), 0.0F);
        return level.noCollision(entity);
    }

    private static <T extends Mob> T spawnNear(EntityType<T> type, ServerLevel level, ServerPlayer player, String donor,
                                               double minRadius, double maxRadius, boolean natural, boolean chaos) {
        T mob = type.create(level);
        if (mob == null) throw new ChaosException("failed");
        if (!place(mob, level, player, minRadius, maxRadius)) throw new ChaosException("no-space");
        if (natural) mob.finalizeSpawn(level, level.getCurrentDifficultyAt(mob.blockPosition()), MobSpawnType.EVENT, null, null);
        name(mob, donor);
        if (chaos) mob.addTag(CHAOS_TAG);
        if (!level.addFreshEntity(mob)) throw new ChaosException("failed");
        return mob;
    }

    private static void chickenRain(ServerLevel level, ServerPlayer player, int count) {
        for (int i = 0; i < count; i++) {
            Mob chicken = EntityType.CHICKEN.create(level);
            if (chicken == null) continue;
            double angle = Math.PI * 2 * i / count;
            chicken.moveTo(player.getX() + Math.cos(angle) * 3, player.getY() + 6, player.getZ() + Math.sin(angle) * 3, 0, 0);
            chicken.addTag(CHAOS_TAG);
            level.addFreshEntity(chicken);
        }
    }

    private static void lightning(ServerLevel level, ServerPlayer player) {
        LightningBolt bolt = EntityType.LIGHTNING_BOLT.create(level);
        if (bolt == null) throw new ChaosException("failed");
        bolt.setVisualOnly(true); // без пожаров и урона постройкам
        bolt.moveTo(player.getX() + 2, player.getY(), player.getZ() + 2);
        level.addFreshEntity(bolt);
    }

    private static void fakeTnt(ServerLevel level, ServerPlayer player, String donor) {
        PrimedTnt tnt = new PrimedTnt(level, player.getX(), player.getY(), player.getZ(), null);
        place(tnt, level, player, 1.5, 3);
        tnt.setFuse(60);
        tnt.addTag(FAKE_TNT_TAG);
        name(tnt, donor);
        level.addFreshEntity(tnt);
        level.playSound(null, tnt.getX(), tnt.getY(), tnt.getZ(), SoundEvents.TNT_PRIMED, SoundSource.BLOCKS, 1.0F, 1.0F);
    }
}
