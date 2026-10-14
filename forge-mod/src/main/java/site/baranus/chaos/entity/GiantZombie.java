package site.baranus.chaos.entity;

import java.util.UUID;
import javax.annotation.Nullable;
import net.minecraft.nbt.CompoundTag;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EntityDimensions;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Pose;
import net.minecraft.world.entity.ai.attributes.AttributeSupplier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.entity.monster.Zombie;
import net.minecraft.world.entity.projectile.SmallFireball;
import net.minecraft.world.level.Level;
import net.minecraft.world.phys.Vec3;

/** Огненный гигант: ИИ зомби, преследует выбранного игрока и стреляет огненными шарами. Живёт 3 минуты. */
public class GiantZombie extends Zombie {
    private static final int MAX_LIFE = 20 * 180;
    @Nullable private UUID markedPlayer;
    private int ageTicks;
    private int fireballDelay = 45;

    public GiantZombie(EntityType<? extends Zombie> type, Level level) { super(type, level); }

    public static AttributeSupplier.Builder createAttributes() {
        return Zombie.createAttributes()
            .add(Attributes.MAX_HEALTH, 160.0D)
            .add(Attributes.ATTACK_DAMAGE, 11.0D)
            .add(Attributes.MOVEMENT_SPEED, 0.38D)
            .add(Attributes.FOLLOW_RANGE, 56.0D)
            .add(Attributes.KNOCKBACK_RESISTANCE, 0.9D);
    }

    public int ageTicks() { return ageTicks; }

    public boolean isChasing(UUID playerId) {
        return playerId.equals(markedPlayer) && isAlive();
    }

    public void chase(ServerPlayer player) {
        markedPlayer = player.getUUID();
        setTarget(player);
        setPersistenceRequired();
    }

    /** У обычного зомби глаза на высоте 1,74 — для гиганта ростом 8,7 блока это колени. */
    @Override
    protected float getStandingEyeHeight(Pose pose, EntityDimensions dimensions) {
        return dimensions.height * 0.85F;
    }

    @Override
    public void aiStep() {
        super.aiStep();
        if (!(level() instanceof ServerLevel level)) return;
        if (++ageTicks >= MAX_LIFE) { discard(); return; }
        if (markedPlayer == null) return;
        ServerPlayer player = level.getServer().getPlayerList().getPlayer(markedPlayer);
        if (player == null || !player.isAlive() || player.serverLevel() != level || player.isSpectator()) {
            setTarget(null);
            return;
        }
        if (getTarget() != player) setTarget(player);
        if (--fireballDelay > 0) return;
        fireballDelay = 54;
        if (distanceToSqr(player) > 38.0D * 38.0D || !hasLineOfSight(player)) return;
        Vec3 start = new Vec3(getX(), getEyeY() - 0.8D, getZ());
        Vec3 aim = player.getEyePosition().subtract(start);
        if (aim.lengthSqr() < 0.001D) return;
        Vec3 direction = aim.normalize();
        SmallFireball fireball = new SmallFireball(level, this, direction.x, direction.y, direction.z);
        fireball.setPos(start.x + direction.x * 2.0D, start.y, start.z + direction.z * 2.0D);
        level.addFreshEntity(fireball);
    }

    @Override
    protected boolean isSunSensitive() { return false; }

    @Override
    protected boolean convertsInWater() { return false; }

    @Override
    public boolean isBaby() { return false; }

    @Override
    public void addAdditionalSaveData(CompoundTag tag) {
        super.addAdditionalSaveData(tag);
        if (markedPlayer != null) tag.putUUID("BaranusTarget", markedPlayer);
        tag.putInt("BaranusAge", ageTicks);
        tag.putInt("BaranusFireDelay", fireballDelay);
    }

    @Override
    public void readAdditionalSaveData(CompoundTag tag) {
        super.readAdditionalSaveData(tag);
        if (tag.hasUUID("BaranusTarget")) markedPlayer = tag.getUUID("BaranusTarget");
        ageTicks = tag.getInt("BaranusAge");
        fireballDelay = Math.max(1, tag.getInt("BaranusFireDelay"));
    }
}
