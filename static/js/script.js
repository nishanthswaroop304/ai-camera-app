document.addEventListener('DOMContentLoaded', () => {
    // DOM elements
    const cameraElement = document.getElementById('camera');
    const flipCameraBtn = document.getElementById('flip-camera');
    const recordBtn = document.getElementById('record-btn');
    const recordIcon = document.getElementById('record-icon');
    const recordingIndicator = document.getElementById('recording-indicator');
    const realtimeIndicator = document.getElementById('realtime-indicator');
    const analyzeBtn = document.getElementById('analyze-btn');
    const promptInput = document.getElementById('prompt-input');
    const systemMessageInput = document.getElementById('system-message');
    const aiModelSelect = document.getElementById('ai-model');
    const frameIntervalInput = document.getElementById('frame-interval');
    const analysisModeSelect = document.getElementById('analysis-mode');
    const audioFeedbackCheckbox = document.getElementById('audio-feedback');
    const resultContent = document.getElementById('result-content');
    const loadingIndicator = document.getElementById('loading-indicator');
    const promptTemplatesToggle = document.querySelector('.prompt-templates-toggle');
    const promptTemplates = document.querySelector('.prompt-templates');
    const copyButtons = document.querySelectorAll('.copy-btn');
    
    // Camera variables
    let stream = null;
    let mediaRecorder = null;
    let recordedChunks = [];
    let isRecording = false;
    let usingFrontCamera = true;
    let realtimeAnalysisActive = false;
    let realtimeInterval = null;
    let frameCount = 0;
    let pendingAnalysis = false;
    let hasCameraPermission = false;
    
    // Audio elements
    let chimeAudio = new Audio('static/chime.m4a');
    let speechSynthesis = window.speechSynthesis;
    let speaking = false;
    
    // Initialize camera
    async function initCamera() {
        try {
            console.log("📸 Requesting camera access with mode:", usingFrontCamera ? "front" : "back");
            
            // Stop any existing stream
            if (stream) {
                stream.getTracks().forEach(track => track.stop());
            }
            
            // Set up constraints for camera (front or back)
            const constraints = {
                video: {
                    facingMode: usingFrontCamera ? 'user' : 'environment',
                    width: { ideal: 1280 },
                    height: { ideal: 720 }
                },
                audio: false
            };
            
            // Get media stream
            stream = await navigator.mediaDevices.getUserMedia(constraints);
            cameraElement.srcObject = stream;
            hasCameraPermission = true;
            
            // Set up media recorder
            setupMediaRecorder();
            
            console.log("✅ Camera initialized successfully");
            
        } catch (error) {
            console.error('❌ Error accessing camera:', error);
            alert('Unable to access camera. Please ensure you have granted camera permissions and try refreshing the page.');
        }
    }
    
    // Setup media recorder
    function setupMediaRecorder() {
        // Check if MediaRecorder is available
        if (!window.MediaRecorder) {
            console.error("❌ MediaRecorder not supported in this browser");
            alert("Recording is not supported in this browser. Please try Chrome, Firefox, or Safari.");
            return;
        }
        
        // Try to use webm format which is widely supported
        let options = { mimeType: 'video/webm' };
        
        try {
            // Set up media recorder with the stream
            mediaRecorder = new MediaRecorder(stream, options);
            
            // Event handlers for the media recorder
            mediaRecorder.ondataavailable = (event) => {
                if (event.data && event.data.size > 0) {
                    recordedChunks.push(event.data);
                }
            };
            
            mediaRecorder.onstop = () => {
                // Enable the analyze button when recording is done
                analyzeBtn.disabled = false;
                console.log("✅ Recording stopped, data available");
            };
            
            mediaRecorder.onerror = (event) => {
                console.error("❌ Media recorder error:", event.error);
            };
            
        } catch (err) {
            console.error("❌ Error setting up MediaRecorder:", err);
            
            // Try fallback options
            try {
                options = { mimeType: 'video/mp4' };
                mediaRecorder = new MediaRecorder(stream, options);
                console.log("⚠️ Using fallback recording format: mp4");
            } catch (err2) {
                console.error("❌ Fallback MediaRecorder failed too:", err2);
                alert("Your browser doesn't support video recording. Please try a different browser.");
            }
        }
    }
    
    // Toggle camera (front/back)
    function toggleCamera() {
        console.log("🔄 Toggling camera: " + (usingFrontCamera ? "Front → Back" : "Back → Front"));
        usingFrontCamera = !usingFrontCamera;
        initCamera();
    }
    
    // Start recording
    function startRecording() {
        if (!mediaRecorder || mediaRecorder.state === 'recording') {
            console.warn("⚠️ MediaRecorder not ready or already recording");
            return;
        }
        
        console.log("🔴 Starting recording");
        recordedChunks = [];
        try {
            mediaRecorder.start();
            isRecording = true;
            frameCount = 0;
            
            // Update UI
            recordIcon.classList.add('recording');
            recordingIndicator.classList.add('active');
            analyzeBtn.disabled = true;
            
            // Check if real-time analysis is selected
            if (analysisModeSelect.value === 'realtime') {
                startRealtimeAnalysis();
            }
        } catch (err) {
            console.error("❌ Error starting recording:", err);
            alert("Failed to start recording. Please check camera permissions and try again.");
        }
    }
    
    // Stop recording
    function stopRecording() {
        if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            console.warn("⚠️ MediaRecorder not recording");
            return;
        }
        
        console.log("⏹️ Stopping recording");
        try {
            mediaRecorder.stop();
            isRecording = false;
            
            // Update UI
            recordIcon.classList.remove('recording');
            recordingIndicator.classList.remove('active');
            
            // Stop real-time analysis if active
            if (realtimeAnalysisActive) {
                stopRealtimeAnalysis();
            }
        } catch (err) {
            console.error("❌ Error stopping recording:", err);
        }
    }
    
    // Start real-time analysis
    function startRealtimeAnalysis() {
        console.log("🔄 Starting real-time frame analysis");
        realtimeAnalysisActive = true;
        realtimeIndicator.classList.add('active');
        resultContent.innerHTML = ''; // Clear previous results
        
        // Calculate interval based on frame interval input (in milliseconds)
        const intervalMs = frameIntervalInput.value * 1000;
        
        // Set up interval for capturing frames
        realtimeInterval = setInterval(() => {
            if (!isRecording || pendingAnalysis) return;
            captureAndAnalyzeFrame();
        }, intervalMs);
    }
    
    // Stop real-time analysis
    function stopRealtimeAnalysis() {
        console.log("⏹️ Stopping real-time analysis");
        realtimeAnalysisActive = false;
        realtimeIndicator.classList.remove('active');
        
        if (realtimeInterval) {
            clearInterval(realtimeInterval);
            realtimeInterval = null;
        }
        
        // Stop any ongoing speech
        if (speechSynthesis && speaking) {
            speechSynthesis.cancel();
            speaking = false;
        }
    }
    
    // Capture and analyze current frame
    async function captureAndAnalyzeFrame() {
        if (!stream || !isRecording) return;
        
        try {
            pendingAnalysis = true;
            frameCount++;
            console.log(`📸 Capturing frame #${frameCount} for real-time analysis`);
            
            // Create a canvas to capture the current frame
            const canvas = document.createElement('canvas');
            canvas.width = cameraElement.videoWidth;
            canvas.height = cameraElement.videoHeight;
            const ctx = canvas.getContext('2d');
            
            if (!ctx) {
                console.error("❌ Failed to get canvas context");
                pendingAnalysis = false;
                return;
            }
            
            // Draw the current frame to the canvas (flip horizontally if using front camera)
            ctx.drawImage(cameraElement, 0, 0, canvas.width, canvas.height);
            
            // Convert canvas to base64 image
            const base64Frame = canvas.toDataURL('image/jpeg', 0.8);
            
            // Get current settings
            const prompt = promptInput.value || 'What do you see in this image?';
            const systemMessage = systemMessageInput.value || '';
            const model = aiModelSelect.value;
            
            console.log(`🔄 Sending frame #${frameCount} for real-time analysis`);
            
            // Send to server for processing
            const response = await fetch('/analyze_frame', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    frame: base64Frame,
                    prompt: prompt,
                    systemMessage: systemMessage,
                    model: model,
                    frameNumber: frameCount
                })
            });
            
            const data = await response.json();
            
            if (data.success) {
                console.log(`✅ Received analysis for frame #${data.frameNumber}`);
                
                // Create frame result element
                const entryDiv = document.createElement('div');
                entryDiv.className = 'result-entry';
                
                const frameLabel = document.createElement('div');
                frameLabel.className = 'result-frame';
                frameLabel.textContent = `Frame ${data.frameNumber}:`;
                
                const contentDiv = document.createElement('div');
                contentDiv.innerHTML = marked.parse(data.result);
                
                entryDiv.appendChild(frameLabel);
                entryDiv.appendChild(contentDiv);
                
                // Insert at the top for newest results first
                if (resultContent.firstChild) {
                    resultContent.insertBefore(entryDiv, resultContent.firstChild);
                } else {
                    resultContent.appendChild(entryDiv);
                }
                
                // Play audio and speak result if enabled
                if (audioFeedbackCheckbox.checked && data.result.trim() !== 'N/A') {
                    // Play chime sound
                    try {
                        chimeAudio.currentTime = 0;
                        chimeAudio.play().catch(e => console.error("Couldn't play chime:", e));
                    } catch (err) {
                        console.error("Error playing chime:", err);
                    }
                    
                    // Read out the result using speech synthesis
                    setTimeout(() => {
                        if (speechSynthesis && !speaking) {
                            speaking = true;
                            const utterance = new SpeechSynthesisUtterance(data.result);
                            utterance.onend = () => {
                                speaking = false;
                            };
                            utterance.onerror = () => {
                                speaking = false;
                            };
                            speechSynthesis.speak(utterance);
                        }
                    }, 800); // Wait for chime to finish
                }
            } else {
                console.error(`❌ Analysis failed for frame #${data.frameNumber}:`, data.error);
            }
            
        } catch (error) {
            console.error('❌ Error in real-time analysis:', error);
        } finally {
            pendingAnalysis = false;
        }
    }
    
    // Analyze recorded video
    async function analyzeVideo() {
        if (recordedChunks.length === 0) {
            alert('Please record a video first');
            return;
        }
        
        console.log("🔍 Starting video analysis");
        
        // Show loading indicator
        loadingIndicator.classList.remove('hidden');
        resultContent.textContent = '';
        
        try {
            // Create a blob from the recorded chunks
            const blob = new Blob(recordedChunks, { type: 'video/webm' });
            console.log(`📊 Video size: ${(blob.size / 1024 / 1024).toFixed(2)} MB`);
            
            // Convert blob to base64
            console.log("🔄 Converting video to base64");
            const base64Video = await blobToBase64(blob);
            
            // Get settings from the UI
            const prompt = promptInput.value || 'What do you see in these images?';
            const systemMessage = systemMessageInput.value || '';
            const model = aiModelSelect.value;
            const frameInterval = frameIntervalInput.value;
            const analysisMode = analysisModeSelect.value;
            
            console.log(`📋 Analysis settings:
            - Model: ${model}
            - Frame interval: ${frameInterval}s
            - Analysis mode: ${analysisMode}
            - Prompt: ${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}
            - System message: ${systemMessage ? 'provided' : 'none'}`);
            
            // Send to server for processing
            console.log("📤 Sending video to server for processing");
            const response = await fetch('/process_video', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    video: base64Video,
                    prompt: prompt,
                    systemMessage: systemMessage,
                    model: model,
                    frameInterval: frameInterval,
                    analysisMode: analysisMode
                })
            });
            
            const data = await response.json();
            console.log("📥 Received response from server");
            
            if (data.success) {
                console.log("✅ Analysis successful");
                
                // Clear previous results
                resultContent.innerHTML = '';
                
                if (Array.isArray(data.result)) {
                    // Display individual frame results
                    console.log(`📊 Received ${data.result.length} individual frame analyses`);
                    data.result.forEach((item, index) => {
                        const entryDiv = document.createElement('div');
                        entryDiv.className = 'result-entry';
                        
                        const frameLabel = document.createElement('div');
                        frameLabel.className = 'result-frame';
                        frameLabel.textContent = `Frame ${index + 1}:`;
                        
                        const contentDiv = document.createElement('div');
                        contentDiv.innerHTML = marked.parse(item);
                        
                        entryDiv.appendChild(frameLabel);
                        entryDiv.appendChild(contentDiv);
                        resultContent.appendChild(entryDiv);
                    });
                } else {
                    // Display single batch result
                    console.log("📊 Received batch analysis");
                    resultContent.innerHTML = marked.parse(data.result);
                }
            } else {
                console.error("❌ Analysis failed:", data.error);
                resultContent.textContent = 'Error: ' + (data.error || 'Failed to analyze video');
            }
        } catch (error) {
            console.error('❌ Error analyzing video:', error);
            resultContent.textContent = 'Error analyzing video. Please try again.';
        } finally {
            // Hide loading indicator
            console.log("🏁 Analysis process completed");
            loadingIndicator.classList.add('hidden');
        }
    }
    
    // Helper function: Convert blob to base64
    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    }
    
    // Check if analysis mode changed to realtime
    analysisModeSelect.addEventListener('change', () => {
        const isRealtime = analysisModeSelect.value === 'realtime';
        // Show/hide audio feedback option based on analysis mode
        document.querySelector('.audio-settings').style.display = isRealtime ? 'block' : 'none';
        
        if (isRealtime) {
            console.log("🔄 Real-time analysis mode selected");
            if (isRecording && !realtimeAnalysisActive) {
                startRealtimeAnalysis();
            }
        } else if (realtimeAnalysisActive) {
            stopRealtimeAnalysis();
        }
    });
    
    // Event listeners with both click and touch support
    flipCameraBtn.addEventListener('click', function(event) {
        event.preventDefault();
        console.log("🔄 Flip camera button clicked");
        toggleCamera();
    });
    
    flipCameraBtn.addEventListener('touchend', function(event) {
        event.preventDefault();
        console.log("🔄 Flip camera button touched");
        toggleCamera();
        return false;
    });
    
    recordBtn.addEventListener('click', function(event) {
        event.preventDefault();
        console.log("⏺️ Record button clicked");
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
    });
    
    recordBtn.addEventListener('touchend', function(event) {
        event.preventDefault();
        console.log("⏺️ Record button touched");
        if (isRecording) {
            stopRecording();
        } else {
            startRecording();
        }
        return false;
    });
    
    analyzeBtn.addEventListener('click', analyzeVideo);
    
    // Setup prompt templates
    promptTemplatesToggle.addEventListener('click', () => {
        promptTemplatesToggle.classList.toggle('open');
        promptTemplates.classList.toggle('open');
    });
    
    // Setup copy buttons for templates
    copyButtons.forEach(button => {
        button.addEventListener('click', () => {
            let templateText = '';
            
            switch(button.dataset.template) {
                case 'shopping':
                    templateText = 'You are a shopping assistant helping people choose the healthiest products. Analyze the products shown in the images and clearly identify the healthiest option. Format your response in markdown, use emojis, and be concise. Always start with the best product, include a one-line benefit, and briefly mention other products you analyzed. Keep your response clear and direct.';
                    break;
                case 'traffic':
                    templateText = 'Analyze the image to identify traffic lights with solid colors only. Ignore arrow lights regardless of color. If a solid light is on, return only one of these responses: "GREEN", "RED", or "YELLOW". If no traffic lights are turned on or visible, return only "N/A".';
                    break;
                case 'distance':
                    templateText = 'Estimate the distance of the car in front of me in terms of car lengths. If the distance appears to be more than approximately 2 car lengths, respond only with "TOO FAR". If it\'s less than 2 car lengths, respond only with "TOO CLOSE". In all other cases (no cars visible, unclear distance, etc.), respond only with "N/A".';
                    break;
            }
            
            systemMessageInput.value = templateText;
            button.textContent = 'Copied!';
            setTimeout(() => {
                button.textContent = 'Copy';
            }, 2000);
        });
    });
    
    // Initialize the app
    console.log("🚀 Initializing AI Camera App");
    
    // Request permissions on iOS devices
    function requestDevicePermissions() {
        // For iOS 13+ motion sensors
        if (typeof DeviceOrientationEvent !== 'undefined' && 
            typeof DeviceOrientationEvent.requestPermission === 'function') {
            
            document.body.addEventListener('click', async function permissionRequest() {
                try {
                    const response = await DeviceOrientationEvent.requestPermission();
                    if (response === 'granted') {
                        console.log("✅ Device orientation permissions granted");
                    }
                } catch (error) {
                    console.error("❌ Error requesting device orientation permission:", error);
                }
                document.body.removeEventListener('click', permissionRequest);
            }, { once: true });
        }
    }
    
    // Try to load the chime sound
    chimeAudio.addEventListener('error', function() {
        console.error("❌ Error loading chime.m4a sound file");
        // Create a fallback chime using AudioContext if the file doesn't load
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            if (AudioContext) {
                const ctx = new AudioContext();
                chimeAudio = {
                    play: function() {
                        const oscillator = ctx.createOscillator();
                        const gain = ctx.createGain();
                        oscillator.connect(gain);
                        gain.connect(ctx.destination);
                        oscillator.frequency.value = 1000;
                        gain.gain.setValueAtTime(0.1, ctx.currentTime);
                        oscillator.start();
                        oscillator.stop(ctx.currentTime + 0.3);
                        return Promise.resolve();
                    },
                    currentTime: 0
                };
                console.log("✅ Created fallback audio chime");
            }
        } catch (err) {
            console.error("❌ Could not create fallback audio:", err);
        }
    });
    
    // Disable audio feedback if speech synthesis isn't available
    if (!window.speechSynthesis) {
        console.warn("⚠️ Speech synthesis not available in this browser");
        audioFeedbackCheckbox.disabled = true;
        audioFeedbackCheckbox.parentNode.classList.add('disabled');
    }
    
    // Set default values
    promptInput.value = 'What do you see in these images?';
    // System message is left empty by default
    
    // Handle visibility change to restart camera if needed
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && hasCameraPermission && !stream) {
            console.log("📱 Page became visible, reinitializing camera");
            initCamera();
        }
    });
    
    // Handle mobile orientation changes
    window.addEventListener('orientationchange', () => {
        setTimeout(() => {
            // Small delay to let the browser adjust to new orientation
            if (hasCameraPermission) {
                console.log("📱 Orientation changed, reinitializing camera");
                initCamera();
            }
        }, 500);
    });
    
    // Request device permissions and initialize camera
    requestDevicePermissions();
    initCamera();
});