from pydub import AudioSegment

# Cargar audio (mp3, wav, etc.)
audio = AudioSegment.from_file("audio.mp3")

# Duración de 30 min en milisegundos
chunk_length = 30 * 60 * 1000  

for i in range(0, len(audio), chunk_length):
    chunk = audio[i:i+chunk_length]
    chunk.export(f"chunk_{i//chunk_length}.mp3", format="mp3")
