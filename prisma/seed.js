// Datos de prueba para MbôláMusic
require('dotenv').config();
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Sembrando datos de prueba...');

  const hash = await bcrypt.hash('password123', 10);
  const now = new Date();
  const in30 = new Date(now.getTime() + 30 * 24 * 3600 * 1000);

  // Artista con suscripción activa
  const artist = await prisma.user.create({
    data: {
      email: 'artista@test.com',
      passwordHash: hash,
      role: 'ARTIST',
      username: 'malabo_star',
      country: 'Guinea Ecuatorial',
      city: 'Malabo',
      isVerified: true,
      favoriteGenres: ['Afrosounds', 'Urbano'],
      artistProfile: {
        create: {
          artistName: 'Malabo Star',
          realName: 'Juan Nguema',
          bio: 'Artista urbano de Malabo.',
          idVerified: true,
        },
      },
      subscriptions: {
        create: { type: 'ARTIST_MONTHLY', status: 'ACTIVE', endDate: in30 },
      },
    },
    include: { artistProfile: true },
  });

  // Canciones
  const genres = ['Afrosounds', 'Hip-Hop', 'Urbano', 'Bikutsi'];
  for (let i = 1; i <= 6; i++) {
    await prisma.track.create({
      data: {
        artistId: artist.artistProfile.id,
        title: `Canción ${i}`,
        genre: genres[i % genres.length],
        audioUrl: `/uploads/demo-${i}.mp3`,
        durationSec: 180 + i * 5,
        playCount: Math.floor(Math.random() * 500),
        downloadCount: Math.floor(Math.random() * 100),
      },
    });
  }

  // Oyente con mes gratis
  await prisma.user.create({
    data: {
      email: 'oyente@test.com',
      passwordHash: hash,
      role: 'LISTENER',
      username: 'oyente_bata',
      country: 'Guinea Ecuatorial',
      city: 'Bata',
      isVerified: true,
      favoriteGenres: ['Afrosounds'],
      subscriptions: {
        create: { type: 'LISTENER_FREE', status: 'ACTIVE', endDate: in30 },
      },
    },
  });

  // Administrador
  await prisma.user.create({
    data: {
      email: 'admin@mbolamusic.com',
      passwordHash: hash,
      role: 'ADMIN',
      username: 'admin',
      country: 'Guinea Ecuatorial',
      isVerified: true,
    },
  });

  console.log('✅ Listo.');
  console.log('   Artista: artista@test.com / password123');
  console.log('   Oyente:  oyente@test.com  / password123');
  console.log('   Admin:   admin@mbolamusic.com / password123');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
