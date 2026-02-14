#!/bin/bash

# Directory containing audio files
UPLOAD_DIR="./backend/uploads"
OUTPUT_DIR="./backend/uploads/optimized"

mkdir -p "$OUTPUT_DIR"

# Check if ffmpeg is installed
if ! command -v ffmpeg &> /dev/null; then
    echo "Error: ffmpeg is not installed. Please install it first."
    echo "sudo apt update && sudo apt install -y ffmpeg"
    exit 1
fi

echo "Starting audio optimization..."
echo "Target: 64k bitrate (Opus), Mono"

# Loop through all MP3 files
for file in "$UPLOAD_DIR"/*.mp3; do
    if [ -f "$file" ]; then
        filename=$(basename "$file")
        name="${filename%.*}"
        
        echo "Processing: $filename"
        
        # Convert to Opus 64k mono (perfect for speech)
        # -ac 1: Mono (reduces size)
        # -b:a 64k: Bitrate
        # -vbr on: Variable Bitrate
        ffmpeg -i "$file" -c:a libopus -b:a 64k -vbr on -ac 1 "$OUTPUT_DIR/${name}.opus" -y
        
        # Also create optimized MP3 backup if Opus compatibility is a concern (though web supports Opus)
        # ffmpeg -i "$file" -c:a libmp3lame -q:a 4 "$OUTPUT_DIR/${name}.mp3" -y
    fi
done

echo "Optimization complete! Check $OUTPUT_DIR"
