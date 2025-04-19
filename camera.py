from flask import Flask, render_template, request, jsonify
import os
import base64
import tempfile
import cv2
import time
import uuid
from openai import OpenAI
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

app = Flask(__name__)

# Ensure the uploads directory exists
UPLOAD_FOLDER = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOAD_FOLDER, exist_ok=True)

@app.route('/')
def index():
    return render_template('index.html')

@app.route('/process_video', methods=['POST'])
def process_video():
    print("🔍 Received video processing request")
    data = request.json
    video_data = data.get('video').split(',')[1]  # Remove the prefix 'data:video/webm;base64,'
    prompt = data.get('prompt', 'What is in these images?')
    system_message = data.get('systemMessage', '')
    model = data.get('model', 'gpt-4o')
    frame_interval = int(data.get('frameInterval', 1))
    analysis_mode = data.get('analysisMode', 'batch')  # 'batch' or 'sequential'
    
    print(f"📝 Using prompt: {prompt}")
    print(f"⚙️ System message provided: {'Yes' if system_message else 'No'}")
    print(f"🤖 Model selected: {model}")
    print(f"⏱️ Frame interval: {frame_interval} seconds")
    print(f"🔄 Analysis mode: {analysis_mode}")
    
    # Create a unique filename for the video
    video_filename = os.path.join(UPLOAD_FOLDER, f"{uuid.uuid4()}.webm")
    print(f"💾 Saving video to {video_filename}")
    
    # Save the video file
    with open(video_filename, 'wb') as f:
        f.write(base64.b64decode(video_data))
    print("✅ Video saved successfully")
    
    # Extract frames from the video
    print("🎬 Starting frame extraction")
    frames = extract_frames(video_filename, frame_interval)
    print(f"🖼️ Extracted {len(frames)} frames from video")
    
    # Process frames with OpenAI
    if frames:
        if analysis_mode == 'sequential':
            print("🔄 Processing frames individually")
            results = analyze_frames_individually(frames, prompt, model, system_message)
            print(f"✅ Individual analysis complete: {len(results)} frames processed")
            return jsonify({'success': True, 'result': results})
        else:
            print("🔄 Processing all frames together in batch mode")
            result = analyze_frames_with_openai(frames, prompt, model, system_message)
            print("✅ Batch analysis complete")
            return jsonify({'success': True, 'result': result})
    else:
        print("❌ Failed to extract frames from video")
        return jsonify({'success': False, 'error': 'Failed to extract frames from video'})

@app.route('/analyze_frame', methods=['POST'])
def analyze_frame():
    """Endpoint for real-time frame analysis during recording"""
    try:
        print("🔍 Received real-time frame analysis request")
        data = request.json
        frame_data = data.get('frame').split(',')[1]  # Remove the prefix 'data:image/jpeg;base64,'
        prompt = data.get('prompt', 'What is in this image?')
        system_message = data.get('systemMessage', '')
        model = data.get('model', 'gpt-4o')
        frame_number = data.get('frameNumber', 0)
        
        print(f"🖼️ Processing real-time frame #{frame_number}")
        
        # Save the frame temporarily
        frame_filename = os.path.join(UPLOAD_FOLDER, f"realtime_frame_{uuid.uuid4()}.jpg")
        with open(frame_filename, 'wb') as f:
            f.write(base64.b64decode(frame_data))
        
        # Analyze the frame
        result = analyze_single_frame(frame_filename, prompt, model, system_message)
        
        # Clean up
        try:
            os.remove(frame_filename)
        except:
            pass
            
        return jsonify({
            'success': True, 
            'result': result,
            'frameNumber': frame_number
        })
        
    except Exception as e:
        print(f"❌ Error in real-time analysis: {str(e)}")
        import traceback
        print(f"📋 Traceback: {traceback.format_exc()}")
        return jsonify({
            'success': False, 
            'error': str(e),
            'frameNumber': data.get('frameNumber', 0)
        })

def extract_frames(video_path, interval_seconds):
    """Extract frames from video at specified intervals."""
    print(f"🎞️ Opening video file: {video_path}")
    frames = []
    temp_dir = tempfile.mkdtemp()
    print(f"📁 Created temporary directory for frames: {temp_dir}")
    
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print("❌ Could not open video file")
        return []
    
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_interval = int(fps * interval_seconds)
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    
    print(f"ℹ️ Video info - FPS: {fps}, Total frames: {total_frames}")
    print(f"⏱️ Extracting frames at intervals of {frame_interval} frames")
    
    count = 0
    frame_count = 0
    
    while True:
        ret, frame = cap.read()
        if not ret:
            break
        
        if count % frame_interval == 0:
            frame_path = os.path.join(temp_dir, f"frame_{frame_count}.jpg")
            cv2.imwrite(frame_path, frame)
            frames.append(frame_path)
            frame_count += 1
            if frame_count % 5 == 0:  # Log every 5 frames to avoid too much output
                print(f"💾 Saved frame #{frame_count} at position {count}")
        
        count += 1
    
    cap.release()
    print(f"✅ Frame extraction complete. Extracted {frame_count} frames.")
    return frames

def analyze_frames_individually(frame_paths, prompt, model, system_message=None):
    """Send each frame individually to OpenAI for analysis."""
    results = []
    
    try:
        print(f"🔌 Initializing OpenAI client for individual frame analysis")
        client = OpenAI()
        
        # Process each frame individually
        for i, frame_path in enumerate(frame_paths):
            print(f"🖼️ Processing frame {i+1}/{len(frame_paths)}")
            
            # Encode current frame
            base64_image = encode_image(frame_path)
            
            # Prepare the content array with the prompt and current frame
            content = [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{base64_image}"
                    }
                }
            ]
            
            # Prepare messages with optional system message
            messages = []
            
            # Add system message if provided
            if system_message and system_message.strip():
                messages.append({"role": "system", "content": system_message})
            
            # Add user message with prompt and current frame
            messages.append({"role": "user", "content": content})
            
            # Make the API call for this frame
            print(f"🔄 Sending frame {i+1} to OpenAI API (model: {model})")
            response = client.chat.completions.create(
                model=model,
                messages=messages,
                max_tokens=500
            )
            
            # Add result to our collection
            frame_result = response.choices[0].message.content
            results.append(frame_result)
            print(f"✅ Received analysis for frame {i+1}")
            
        return results
        
    except Exception as e:
        print(f"❌ Error in individual frame analysis: {str(e)}")
        import traceback
        print(f"📋 Traceback: {traceback.format_exc()}")
        return [f"Error analyzing frames: {str(e)}"]

def analyze_single_frame(frame_path, prompt, model, system_message=None):
    """Analyze a single frame with OpenAI."""
    try:
        client = OpenAI()
        
        # Encode frame
        base64_image = encode_image(frame_path)
        
        # Prepare the content array with the prompt and frame
        content = [
            {"type": "text", "text": prompt},
            {
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}"
                }
            }
        ]
        
        # Prepare messages with optional system message
        messages = []
        
        # Add system message if provided
        if system_message and system_message.strip():
            messages.append({"role": "system", "content": system_message})
        
        # Add user message with prompt and image
        messages.append({"role": "user", "content": content})
        
        # Make the API call
        print(f"🔄 Sending real-time frame to OpenAI API (model: {model})")
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=500
        )
        
        print(f"✅ Received real-time analysis from OpenAI")
        return response.choices[0].message.content
        
    except Exception as e:
        print(f"❌ Error analyzing real-time frame: {str(e)}")
        import traceback
        print(f"📋 Traceback: {traceback.format_exc()}")
        return f"Error analyzing frame: {str(e)}"

def analyze_frames_with_openai(frame_paths, prompt, model, system_message=None):
    """Send all frames together to OpenAI for batch analysis."""
    try:
        print(f"🔌 Initializing OpenAI client for batch analysis")
        client = OpenAI()
        
        # Prepare the content array with the prompt
        content = [
            {"type": "text", "text": prompt}
        ]
        
        # Add each frame as an image URL
        print(f"🖼️ Processing {len(frame_paths)} frames for batch OpenAI analysis")
        for i, frame_path in enumerate(frame_paths):
            print(f"  ↳ Encoding frame {i+1}/{len(frame_paths)}: {frame_path}")
            base64_image = encode_image(frame_path)
            content.append({
                "type": "image_url",
                "image_url": {
                    "url": f"data:image/jpeg;base64,{base64_image}"
                }
            })
        
        # Prepare messages with optional system message
        messages = []
        
        # Add system message if provided
        if system_message and system_message.strip():
            print(f"📝 Adding system message: {system_message[:50]}...")
            messages.append({"role": "system", "content": system_message})
        
        # Add user message with prompt and images
        print(f"📝 Adding user prompt: {prompt}")
        messages.append({"role": "user", "content": content})
        
        # Make the API call
        print(f"🔄 Sending batch request to OpenAI API (model: {model})")
        response = client.chat.completions.create(
            model=model,
            messages=messages,
            max_tokens=1000
        )
        
        print(f"✅ Received response from OpenAI")
        return response.choices[0].message.content
        
    except Exception as e:
        print(f"❌ Error analyzing frames in batch: {str(e)}")
        import traceback
        print(f"📋 Traceback: {traceback.format_exc()}")
        return f"Error analyzing frames: {str(e)}"

def encode_image(image_path):
    """Base64 encode an image file."""
    try:
        with open(image_path, "rb") as image_file:
            encoded = base64.b64encode(image_file.read()).decode("utf-8")
            size_kb = len(encoded) / 1.37 / 1024  # Approximation of original size
            print(f"  ↳ Encoded image: {image_path} (approx. {size_kb:.1f} KB)")
            return encoded
    except Exception as e:
        print(f"❌ Error encoding image {image_path}: {str(e)}")
        raise

if __name__ == '__main__':
    # Get port from environment variable (Heroku sets this)
    port = int(os.environ.get('PORT', 8080))
    
    print("🚀 Starting AI Camera App")
    print(f"📁 Upload folder: {UPLOAD_FOLDER}")
    print(f"🌐 Server running at https://0.0.0.0:{port}")  # Note: changed to https://
    
    # Turn off debug mode in production
    debug_mode = os.environ.get('FLASK_ENV') == 'development'
    app.run(debug=debug_mode, host='0.0.0.0', port=port, ssl_context='adhoc')