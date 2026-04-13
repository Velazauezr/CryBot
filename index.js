require("dotenv").config();

const { Client, GatewayIntentBits } = require("discord.js");
const { 
    joinVoiceChannel, 
    createAudioPlayer, 
    createAudioResource, 
    AudioPlayerStatus, 
    StreamType,
    VoiceConnectionStatus
} = require("@discordjs/voice");
const { spawn } = require("child_process");

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildVoiceStates
    ]
});

const YTDLP_PATH = "yt-dlp";
const FFMPEG_PATH = "ffmpeg";

const queue = new Map();

client.once("ready", () => {
    console.log(`✅ Bot conectado como ${client.user.tag}`);
});

// 🔍 BUSCAR CANCIÓN (FIXED)
async function searchSong(query) {
    return new Promise((resolve, reject) => {
        console.log(`🔍 Buscando: ${query}`);
        
        const ytdlp = spawn(YTDLP_PATH, [
            "ytsearch1:" + query,
            "--get-id"
        ]);
        
        let data = "";
        
        ytdlp.stdout.on("data", chunk => data += chunk.toString());
        ytdlp.stderr.on("data", err => console.log("yt-dlp error:", err.toString()));
        
        ytdlp.on("close", code => {
            if (code !== 0 || !data.trim()) {
                reject("yt-dlp falló");
                return;
            }
            
            const videoId = data.trim();
            resolve(`https://www.youtube.com/watch?v=${videoId}`);
        });
    });
}

// 🎵 OBTENER TÍTULO
async function getVideoTitle(url) {
    return new Promise((resolve, reject) => {
        const ytdlp = spawn(YTDLP_PATH, ["-e", url]);
        let title = "";
        
        ytdlp.stdout.on("data", chunk => title += chunk.toString());
        
        ytdlp.on("close", code => {
            if (code === 0 && title.trim()) {
                resolve(title.trim());
            } else {
                reject("No se pudo obtener título");
            }
        });
    });
}

// ▶️ REPRODUCIR
async function playSong(guildId, connection) {
    const serverQueue = queue.get(guildId);
    
    if (!serverQueue || !serverQueue.songs.length) {
        if (connection) connection.destroy();
        queue.delete(guildId);
        return;
    }
    
    const song = serverQueue.songs[0];
    console.log(`🎵 Reproduciendo: ${song.title}`);
    
    const ytdlp = spawn(YTDLP_PATH, [
        "-f", "bestaudio",
        "-o", "-",
        "--no-playlist",
        song.url
    ]);
    
    const ffmpeg = spawn(FFMPEG_PATH, [
        "-i", "pipe:0",
        "-f", "s16le",
        "-ar", "48000",
        "-ac", "2",
        "pipe:1"
    ], { stdio: ["pipe", "pipe", "ignore"] });
    
    ytdlp.stdout.pipe(ffmpeg.stdin);
    
    const resource = createAudioResource(ffmpeg.stdout, {
        inputType: StreamType.Raw,
        inlineVolume: true
    });
    
    resource.volume.setVolume(serverQueue.volume || 1.0);
    
    const player = createAudioPlayer();
    serverQueue.player = player;
    serverQueue.connection = connection;
    
    connection.subscribe(player);
    player.play(resource);
    
    player.on(AudioPlayerStatus.Idle, () => {
        serverQueue.songs.shift();
        playSong(guildId, connection);
    });
    
    player.on("error", () => {
        serverQueue.songs.shift();
        playSong(guildId, connection);
    });
    
    connection.on(VoiceConnectionStatus.Disconnected, () => {
        connection.destroy();
        queue.delete(guildId);
    });
}

// 💬 COMANDOS
client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    
    const args = message.content.trim().split(/ +/);
    const command = args.shift().toLowerCase();
    const voiceChannel = message.member.voice.channel;
    
    if (command === "$pm") {
        if (!voiceChannel) return message.channel.send("⚠️ Entra a un canal de voz");
        if (!args.length) return message.channel.send("⚠️ Pon una canción");
        
        if (!queue.has(message.guild.id)) {
            queue.set(message.guild.id, { songs: [], volume: 1.0 });
        }
        
        const serverQueue = queue.get(message.guild.id);
        const msg = await message.channel.send("🔍 Buscando...");
        
        try {
            let url = args.join(" ");
            if (!url.startsWith("http")) {
                url = await searchSong(url);
            }
            
            const title = await getVideoTitle(url);
            serverQueue.songs.push({ url, title });
            
            if (!serverQueue.player) {
                const connection = joinVoiceChannel({
                    channelId: voiceChannel.id,
                    guildId: message.guild.id,
                    adapterCreator: message.guild.voiceAdapterCreator,
                });
                
                playSong(message.guild.id, connection);
                msg.edit(`🎶 Reproduciendo: ${title}`);
            } else {
                msg.edit(`📝 Agregado: ${title}`);
            }
        } catch (err) {
            console.log(err);
            msg.edit("❌ No se encontró la canción");
        }
    }
});

client.login(process.env.TOKEN);
