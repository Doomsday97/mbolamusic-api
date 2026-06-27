// Datos de prueba para MbôláMusic
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// URLs de audio reales (dominio público / libres de derechos)
const DEMO_TRACKS = [
  { title: 'Ritmo de Malabo',       genre: 'Afrobeat',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3' },
  { title: 'Noche en Bata',         genre: 'ndombolo',      url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3' },
  { title: 'Guinea Flow',           genre: 'hiphop',        url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3' },
  { title: 'Amanecer Ecuatorial',   genre: 'pop',           url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-4.mp3' },
  { title: 'Fiesta en Bioko',       genre: 'reggaeton',     url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-5.mp3' },
  { title: 'Bosque Sagrado',        genre: 'tradicional',   url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-6.mp3' },
];

async function main() {
  console.log('🌱 Sembrando datos de prueba...');

  const hash = await bcrypt.hash('password123', 10);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  // Artista con suscripción activa (upsert: no falla si ya existe)
  const artistUser = await prisma.user.upsert({
    where: { email: 'artista@test.com' },
    update: {},
    create: {
      email: 'artista@test.com',
      passwordHash: hash,
      role: 'ARTIST',
      username: 'malabo_star',
      country: 'Guinea Ecuatorial',
      city: 'Malabo',
      isVerified: true,
      favoriteGenres: ['afrobeat', 'reggaeton'],
      artistProfile: {
        create: {
          artistName: 'Malabo Star',
          realName: 'Juan Nguema',
          bio: 'Artista urbano de Malabo, Guinea Ecuatorial.',
          idVerified: true,
        },
      },
      subscriptions: {
        create: { type: 'ARTIST_MONTHLY', status: 'ACTIVE', endDate: in30 },
      },
    },
    include: { artistProfile: true },
  });

  // Actualizar canciones existentes con URLs reales o crear nuevas
  const existingTracks = await prisma.track.findMany({
    where: { artistId: artistUser.artistProfile.id },
    orderBy: { releaseDate: 'asc' },
  });

  if (existingTracks.length > 0) {
    // Actualizar URLs de demo rotas
    for (let i = 0; i < Math.min(existingTracks.length, DEMO_TRACKS.length); i++) {
      const demo = DEMO_TRACKS[i];
      await prisma.track.update({
        where: { id: existingTracks[i].id },
        data: {
          title:   demo.title,
          genre:   demo.genre,
          audioUrl: demo.url,
          isPublished: true,
        },
      });
    }
    console.log(`  → ${existingTracks.length} canciones actualizadas con URLs reales`);
  } else {
    // Crear canciones nuevas
    for (const demo of DEMO_TRACKS) {
      await prisma.track.create({
        data: {
          artistId:      artistUser.artistProfile.id,
          title:         demo.title,
          genre:         demo.genre,
          audioUrl:      demo.url,
          durationSec:   200,
          playCount:     Math.floor(Math.random() * 500),
          downloadCount: Math.floor(Math.random() * 100),
          isPublished:   true,
        },
      });
    }
    console.log(`  → ${DEMO_TRACKS.length} canciones creadas`);
  }

  // Oyente (upsert)
  await prisma.user.upsert({
    where: { email: 'oyente@test.com' },
    update: {},
    create: {
      email: 'oyente@test.com',
      passwordHash: hash,
      role: 'LISTENER',
      username: 'oyente_bata',
      country: 'Guinea Ecuatorial',
      city: 'Bata',
      isVerified: true,
      favoriteGenres: ['afrobeat'],
      subscriptions: {
        create: { type: 'LISTENER_FREE', status: 'ACTIVE', endDate: in30 },
      },
    },
  });

  // Admin (upsert)
  await prisma.user.upsert({
    where: { email: 'admin@mbolamusic.com' },
    update: {},
    create: {
      email: 'admin@mbolamusic.com',
      passwordHash: hash,
      role: 'ADMIN',
      username: 'admin',
      country: 'Guinea Ecuatorial',
      isVerified: true,
    },
  });

  console.log('✅ Seed completado.');
  console.log('   Artista: artista@test.com  / password123');
  console.log('   Oyente:  oyente@test.com   / password123');
  console.log('   Admin:   admin@mbolamusic.com / password123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
