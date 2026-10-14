package site.baranus.chaos;

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;
import site.baranus.chaos.entity.GiantZombie;

public final class ChaosEntities {
    public static final DeferredRegister<EntityType<?>> TYPES =
        DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, BaranusChaosMod.MOD_ID);

    public static final RegistryObject<EntityType<GiantZombie>> GIANT_ZOMBIE = TYPES.register("giant_zombie",
        () -> EntityType.Builder.<GiantZombie>of(GiantZombie::new, MobCategory.MONSTER)
            .sized(3.0F, 8.7F).clientTrackingRange(12)
            .build("baranuschaos:giant_zombie"));

    private ChaosEntities() { }
}
