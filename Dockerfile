
FROM node:22

# Instalar dependencias
RUN apt update && apt install -y ffmpeg python3 python3-pip

# Instalar yt-dlp
RUN pip3 install yt-dlp

WORKDIR /app
COPY . .

RUN npm install

CMD ["node", "index.js"]
