package site.baranus.chaos;

import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.item.PrimedTnt;
import net.minecraftforge.event.RegisterCommandsEvent;
import net.minecraftforge.event.level.ExplosionEvent;
import net.minecraftforge.event.server.ServerStartedEvent;
import net.minecraftforge.event.server.ServerStoppingEvent;
import net.minecraftforge.eventbus.api.SubscribeEvent;

public final class ChaosEvents {
    @SubscribeEvent
    public void commands(RegisterCommandsEvent event) {
        ChaosCommands.register(event.getDispatcher());
    }

    /** Мост для приложения стартует вместе с миром — и в одиночной игре, и на сервере. */
    @SubscribeEvent
    public void serverStarted(ServerStartedEvent event) {
        LocalBridge.start(event.getServer());
    }

    @SubscribeEvent
    public void serverStopping(ServerStoppingEvent event) {
        LocalBridge.stop();
    }

    /** Фейковый TNT: вместо взрыва — только звук и вспышка. Блоки и игроки не страдают. */
    @SubscribeEvent
    public void explosion(ExplosionEvent.Start event) {
        if (event.getExplosion().getExploder() instanceof PrimedTnt tnt
            && tnt.getTags().contains(ChaosEffects.FAKE_TNT_TAG)
            && event.getLevel() instanceof ServerLevel level) {
            event.setCanceled(true);
            level.sendParticles(ParticleTypes.EXPLOSION_EMITTER, tnt.getX(), tnt.getY(), tnt.getZ(), 1, 0, 0, 0, 0);
            level.playSound(null, tnt.getX(), tnt.getY(), tnt.getZ(), SoundEvents.GENERIC_EXPLODE, SoundSource.BLOCKS, 2.0F, 1.0F);
        }
    }
}
