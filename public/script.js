// ======================
// Dashboard Elements
// ======================
const localVideo = document.getElementById('localVideo');
const remoteVideo = document.getElementById('remoteVideo');
const startCallButton = document.getElementById('startCall');
const toggleVideoButton = document.getElementById('toggleVideo');
const toggleAudioButton = document.getElementById('toggleAudio');

// Stats display elements
const rttDisplay = document.getElementById('rtt');
const bitrateInDisplay = document.getElementById('bitrateIn');
const bitrateOutDisplay = document.getElementById('bitrateOut');
const packetsLostDisplay = document.getElementById('packetsLost');
const jitterDisplay = document.getElementById('jitter');
const frameRateDisplay = document.getElementById('frameRate');
const framesDroppedDisplay = document.getElementById('framesDropped');
const networkTypeDisplay = document.getElementById('networkType');
const downlinkDisplay = document.getElementById('downlink');
const decisionDisplay = document.getElementById('decisionText');
const rttTrendDisplay = document.getElementById('rttTrend');
const qualityScoreDisplay = document.getElementById('qualityScore');

// Threshold display elements
const rttThresholdDisplay = document.getElementById('rttThreshold');
const bitrateInThresholdDisplay = document.getElementById('bitrateInThreshold');
const packetsLostThresholdDisplay = document.getElementById('packetsLostThreshold');
const frameDropThresholdDisplay = document.getElementById('frameDropThreshold');
const jitterThresholdDisplay = document.getElementById('jitterThreshold');

// Network info elements
const activeLocalEndpointDisplay = document.getElementById('activeLocalEndpoint');
const activeRemoteEndpointDisplay = document.getElementById('activeRemoteEndpoint');
const decisionBox = document.getElementById('decision');

// Toast notification setup
const toastContainer = document.createElement('div');
toastContainer.id = 'toastContainer';
toastContainer.style.position = 'fixed';
toastContainer.style.bottom = '20px';
toastContainer.style.right = '20px';
toastContainer.style.zIndex = '10000';
document.body.appendChild(toastContainer);

/**
 * Displays a temporary toast notification
 * @param {string} message - The message to display
 * @param {number} duration - How long to show the toast (ms)
 */
function showToast(message, duration = 3000) {
    const toast = document.createElement('div');
    toast.textContent = message;
    toast.style.background = 'rgba(0,0,0,0.7)';
    toast.style.color = 'white';
    toast.style.padding = '10px 20px';
    toast.style.marginTop = '10px';
    toast.style.borderRadius = '8px';
    toast.style.fontSize = '14px';
    toast.style.boxShadow = '0px 0px 8px rgba(0,0,0,0.3)';
    toastContainer.appendChild(toast);
    setTimeout(() => toast.remove(), duration);
}

// ======================
// WebRTC Variables
// ======================
let localStream;
let remoteConnection;
let socket = io("https://7f0f-2600-4041-70e9-1100-40d6-5c3e-41e5-3d18.ngrok-free.app");
let statsIntervalId = null;
let decisionTimeoutId = null;
let isCallActive = false;
let decisionWarmupDone = false;
let lastLoggedEndpoint = null;
let isSwitching = false;

// Stats tracking object
let callStats = {
    rtt: 0,
    bitrateIn: 0,
    bitrateOut: 0,
    packetsLost: 0,
    jitter: 0,
    frameRate: 0,
    framesDropped: 0,
    networkType: '',
    downlink: 0
};

// Previous stats for delta calculations
let previousStats = {
    inboundVideo: null,
    outboundVideo: null,
    candidatePair: null 
};

// ======================
// Thresholds & Configuration
// ======================
const RTT_THRESHOLD = 200; // ms
const BITRATE_THRESHOLD = 400; // kbps 
const PACKET_LOSS_THRESHOLD = 5; // %
const FRAME_DROP_THRESHOLD = 20; // frames
const JITTER_THRESHOLD = 40; // ms

// Quality score weights
const RTT_WEIGHT = 0.2;
const BITRATE_WEIGHT = 0.2;
const PACKET_LOSS_WEIGHT = 0.25;
const FRAME_DROP_WEIGHT = 0.15;
const JITTER_WEIGHT = 0.2;

// RTT trend analysis
const RTT_TREND_WINDOW = 5; 
let rttHistory = [];
const RTT_TREND_THRESHOLD = 20; 

// History data for graphs
const HISTORY_LENGTH = 5;
let rttHistoryData = [];
let bitrateInHistoryData = [];
let jitterHistoryData = [];

// Degradation monitoring
let degradationStartTime = null;
const MIN_DEGRADATION_DURATION_MS = 5000;

// Stats logging
let statsLog = [];
let lastLoggedDecision = "";

// ======================
// Initialization
// ======================

// Get user media on load
navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    .then(stream => {
        localStream = stream;
        localVideo.srcObject = localStream;
        console.log("Local media stream obtained.");
    })
    .catch(error => {
        console.error("Error accessing media:", error);
        alert("Error accessing camera/microphone. Please check permissions.");
    });

// Event listeners
startCallButton.addEventListener('click', startCall);
toggleVideoButton.addEventListener('click', toggleVideo);
toggleAudioButton.addEventListener('click', toggleAudio);

// ======================
// WebRTC Connection Logic
// ======================

/**
 * Creates a new RTCPeerConnection and sets up event handlers
 */
function createPeerConnection() {
    console.log("Creating Peer Connection.");
    remoteConnection = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // ICE candidate handler
    remoteConnection.onicecandidate = event => {
        if (event.candidate) {
            const cand = event.candidate;
            const ip = cand.address || cand.ip || '';
            
            if (!ip.includes(':')) {  // IPv4 only
                console.log("Sending IPv4 ICE candidate:", ip);
                socket.emit('ice-candidate', { candidate: cand });
            } else {
                console.log("Skipping IPv6 candidate:", ip);
            }
        } else {
            console.log("All ICE candidates processed (IPv4 only).");
        }
    };

    // Remote stream handler
    remoteConnection.ontrack = event => {
        console.log("Remote track received:", event.track.kind);
        if (remoteVideo.srcObject !== event.streams[0]) {
            remoteVideo.srcObject = event.streams[0];
            console.log("Assigned remote stream to video element.");
        }
    };

    // Add local tracks if available
    if (localStream) {
        localStream.getTracks().forEach(track => {
            console.log("Adding local track:", track.kind);
            remoteConnection.addTrack(track, localStream);
        });
    } else {
        console.warn("Local stream not ready when creating peer connection.");
    }

    // ICE connection state handler
    remoteConnection.oniceconnectionstatechange = () => {
        console.log("ICE Connection State:", remoteConnection.iceConnectionState);
        
        if (remoteConnection.iceConnectionState === 'connected' || 
            remoteConnection.iceConnectionState === 'completed') {
            if (!isCallActive) {
                isCallActive = true;
                startStatsCollection(); 
                startNetworkMonitoring();
              
                setTimeout(() => {
                    decisionWarmupDone = true;
                    console.log("Decision warmup complete - scoring now active.");
                }, 10000);
            }
        } else if (remoteConnection.iceConnectionState === 'failed') {
            console.error("ICE Connection Failed!");
        } else if (remoteConnection.iceConnectionState === 'disconnected' || 
                   remoteConnection.iceConnectionState === 'closed') {
            isCallActive = false;
            stopStatsCollection();
            if (decisionTimeoutId) {
                clearTimeout(decisionTimeoutId);
                decisionTimeoutId = null;
            }
            console.log("Call disconnected.");
        }
    };
}

// ======================
// Signaling Logic
// ======================

/**
 * Initiates a WebRTC call by creating an offer
 */
function startCall() {
    if (!localStream) {
        alert("Local media not available yet. Please grant permissions.");
        return;
    }
    console.log("Initiating call...");
    startCallButton.disabled = true;
    startCallButton.textContent = "Calling...";
    createPeerConnection();

    // Create and send offer
    remoteConnection.createOffer()
        .then(offer => {
            console.log("Created offer.");
            return remoteConnection.setLocalDescription(offer);
        })
        .then(() => {
            console.log("Set local description, sending offer.");
            socket.emit('offer', { sdp: remoteConnection.localDescription });
        })
        .catch(error => console.error("Error creating offer:", error));
}

// Handle incoming offer
socket.on('offer', (data) => {
    if (!localStream) {
        console.warn("Received offer but local media not ready.");
        return;
    }
    console.log("Received offer.");
    
    if (!remoteConnection || remoteConnection.signalingState === 'closed') {
        createPeerConnection();
    }

    remoteConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => {
            console.log("Set remote description, creating answer.");
            return remoteConnection.createAnswer();
        })
        .then(answer => {
            console.log("Created answer.");
            return remoteConnection.setLocalDescription(answer);
        })
        .then(() => {
            console.log("Set local description, sending answer.");
            socket.emit('answer', { sdp: remoteConnection.localDescription });
        })
        .catch(error => console.error("Error handling offer:", error));
});

// Handle incoming answer
socket.on('answer', (data) => {
    if (!remoteConnection || remoteConnection.signalingState !== 'have-local-offer') {
        console.warn("Received answer in unexpected state:", 
                    remoteConnection ? remoteConnection.signalingState : 'no connection');
        return;
    }
    console.log("Received answer.");
    remoteConnection.setRemoteDescription(new RTCSessionDescription(data.sdp))
        .then(() => console.log("Set remote description from answer."))
        .catch(error => console.error("Error handling answer:", error));
});

// Handle incoming ICE candidates
socket.on('ice-candidate', (data) => {
    if (!remoteConnection || remoteConnection.signalingState === 'closed') {
        console.warn("Received ICE candidate but no connection exists or closed.");
        return;
    }
    console.log("Received ICE candidate:", data.candidate.type, data.candidate.address);
    remoteConnection.addIceCandidate(new RTCIceCandidate(data.candidate))
        .catch(error => console.error("Error adding received ICE candidate:", error));
});

// Handle ICE restart requests
socket.on('restart-ice-request', () => {
    if (remoteConnection) {
        console.log("Received ICE restart request from peer.");
        remoteConnection.restartIce();
    }
});

// ======================
// Media Controls
// ======================

/**
 * Toggles video track enabled state
 */
function toggleVideo() {
    if (!localStream) return;
    localStream.getVideoTracks().forEach(track => {
        track.enabled = !track.enabled;
        console.log(`Video track ${track.id} enabled: ${track.enabled}`);
    });
}

/**
 * Toggles audio track enabled state
 */
function toggleAudio() {
    if (!localStream) return;
    localStream.getAudioTracks().forEach(track => {
        track.enabled = !track.enabled;
        console.log(`Audio track ${track.id} enabled: ${track.enabled}`);
    });
}

// ======================
// Statistics Collection
// ======================

/**
 * Logs current stats to memory for later download
 */
function logCurrentStats() {
    const timestamp = new Date().toISOString();
    const currentDecision = decisionDisplay.textContent || 'N/A';
    const entry = {
        time: timestamp,
        rtt: callStats.rtt.toFixed(2),
        bitrateIn: callStats.bitrateIn.toFixed(2),
        bitrateOut: callStats.bitrateOut.toFixed(2),
        packetLoss: callStats.packetsLost.toFixed(2),
        jitter: callStats.jitter.toFixed(2),
        frameRate: callStats.frameRate.toFixed(2),
        framesDropped: callStats.framesDropped,
        qualityScore: calculateQualityScore().toFixed(2),
        decision: currentDecision,
        localEndpoint: activeLocalEndpointDisplay.textContent,
        remoteEndpoint: activeRemoteEndpointDisplay.textContent
    };
    statsLog.push(entry);
}

/**
 * Downloads collected stats as CSV
 */
function downloadCSV() {
    if (statsLog.length === 0) {
        alert("No stats logged yet.");
        return;
    }

    const header = Object.keys(statsLog[0]).join(",");
    const rows = statsLog.map(row => Object.values(row).join(","));
    const csvContent = [header, ...rows].join("\n");

    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = "webrtc_stats_log.csv";
    a.click();
    URL.revokeObjectURL(url);
}

document.getElementById("downloadLog").addEventListener("click", downloadCSV);

/**
 * Starts periodic stats collection
 */
function startStatsCollection() {
    if (statsIntervalId) {
        console.log("Stats collection already running.");
        return;
    }
    if (!remoteConnection) {
        console.warn("Cannot start stats: No PeerConnection.");
        return;
    }
    console.log("Starting stats collection interval.");
    
    statsIntervalId = setInterval(() => {
        if (!remoteConnection || !isCallActive) {
            stopStatsCollection(); 
            return;
        }

        remoteConnection.getStats().then(stats => {
            let newCallStats = { ...callStats };
            let activeLocalEndpoint = 'N/A';
            let activeRemoteEndpoint = 'N/A';

            // Find active candidate pair
            const activePair = Array.from(stats.values()).find(report =>
                report.type === 'candidate-pair' && report.state === 'succeeded'
            );

            if (activePair) {
                newCallStats.rtt = activePair.currentRoundTripTime * 1000; // ms
                const localCandidate = stats.get(activePair.localCandidateId);
                const remoteCandidate = stats.get(activePair.remoteCandidateId);

                if (localCandidate) {
                    activeLocalEndpoint = `${localCandidate.ip || localCandidate.address || 'N/A'}:${localCandidate.port}`;
                }
                if (remoteCandidate) {
                    activeRemoteEndpoint = `${remoteCandidate.ip || remoteCandidate.address || 'N/A'}:${remoteCandidate.port}`;
                }
            } else {
                newCallStats.rtt = 0;
            }

            // Process stats reports
            stats.forEach(report => {
                try {
                    // Inbound Video Metrics
                    if (report.type === 'inbound-rtp' && report.kind === 'video') {
                        if (previousStats.inboundVideo && previousStats.inboundVideo.timestamp) {
                            const bytesDiff = report.bytesReceived - previousStats.inboundVideo.bytesReceived;
                            const timeDiff = (report.timestamp - previousStats.inboundVideo.timestamp) / 1000;
                            if (timeDiff > 0) {
                                newCallStats.bitrateIn = Math.max(0, (bytesDiff * 8) / timeDiff / 1000);

                                const packetsLostNow = report.packetsLost || 0;
                                const prevPacketsLost = previousStats.inboundVideo.packetsLost || 0;
                                const packetsReceivedNow = report.packetsReceived || 0;
                                const prevPacketsReceived = previousStats.inboundVideo.packetsReceived || 0;

                                const packetsLostInterval = packetsLostNow - prevPacketsLost;
                                const packetsReceivedInterval = packetsReceivedNow - prevPacketsReceived;
                                const totalPacketsInterval = packetsLostInterval + packetsReceivedInterval;

                                newCallStats.packetsLost = totalPacketsInterval > 0 ? 
                                    Math.max(0, (packetsLostInterval / totalPacketsInterval) * 100) : 0;
                            } else {
                                newCallStats.bitrateIn = 0;
                                newCallStats.packetsLost = 0;
                            }
                        }
                        newCallStats.jitter = (report.jitter || 0) * 1000;
                        newCallStats.frameRate = report.framesPerSecond || 0;
                        newCallStats.framesDropped = report.framesDropped || 0;
                        previousStats.inboundVideo = report;
                    }

                    // Outbound Video Metrics
                    if (report.type === 'outbound-rtp' && report.kind === 'video') {
                        if (previousStats.outboundVideo && previousStats.outboundVideo.timestamp) {
                            const bytesDiff = report.bytesSent - previousStats.outboundVideo.bytesSent;
                            const timeDiff = (report.timestamp - previousStats.outboundVideo.timestamp) / 1000;
                            if (timeDiff > 0) {
                                newCallStats.bitrateOut = Math.max(0, (bytesDiff * 8) / timeDiff / 1000);
                            } else {
                                newCallStats.bitrateOut = 0;
                            }
                        }
                        previousStats.outboundVideo = report;
                    }
                } catch (e) {
                    console.warn("Error processing stats report:", e, report);
                }
            });
           
            callStats = newCallStats;
            updateStatsDisplay();
            updateActiveNetworkDisplay(activeLocalEndpoint, activeRemoteEndpoint); 
            makeDecision();
            logCurrentStats();
        }).catch(error => console.error("Error getting stats:", error));
    }, 1000);
}

/**
 * Stops stats collection
 */
function stopStatsCollection() {
    if (statsIntervalId) {
        console.log("Stopping stats collection.");
        clearInterval(statsIntervalId);
        statsIntervalId = null;
    }
    if (decisionTimeoutId) {
        clearTimeout(decisionTimeoutId);
        decisionTimeoutId = null;
    }
}

/**
 * Starts monitoring network connection changes
 */
function startNetworkMonitoring() {
    if (!navigator.connection) {
        console.log("navigator.connection API not supported.");
        return;
    }
    console.log("Starting network monitoring (navigator.connection).");
    
    const updateNetworkInfo = () => {
        callStats.networkType = navigator.connection.effectiveType || 'N/A';
        callStats.downlink = navigator.connection.downlink || 0;
        networkTypeDisplay.textContent = callStats.networkType;
        downlinkDisplay.textContent = callStats.downlink.toFixed(2);
    };

    navigator.connection.addEventListener('change', updateNetworkInfo);
    updateNetworkInfo();
}

/**
 * Updates the stats display in the UI
 */
function updateStatsDisplay() {
    // Update stat values
    rttDisplay.textContent = callStats.rtt.toFixed(2);
    bitrateInDisplay.textContent = callStats.bitrateIn.toFixed(2);
    bitrateOutDisplay.textContent = callStats.bitrateOut.toFixed(2);
    packetsLostDisplay.textContent = callStats.packetsLost.toFixed(2);
    jitterDisplay.textContent = callStats.jitter.toFixed(2);
    frameRateDisplay.textContent = callStats.frameRate.toFixed(2);
    framesDroppedDisplay.textContent = callStats.framesDropped;
    networkTypeDisplay.textContent = callStats.networkType;
    downlinkDisplay.textContent = callStats.downlink.toFixed(2);

    // Update threshold displays
    rttThresholdDisplay.textContent = RTT_THRESHOLD;
    bitrateInThresholdDisplay.textContent = BITRATE_THRESHOLD;
    packetsLostThresholdDisplay.textContent = PACKET_LOSS_THRESHOLD;
    frameDropThresholdDisplay.textContent = FRAME_DROP_THRESHOLD;
    jitterThresholdDisplay.textContent = JITTER_THRESHOLD;

    // Update history graphs
    rttHistoryData.push(callStats.rtt);
    if (rttHistoryData.length > HISTORY_LENGTH) rttHistoryData.shift();
    updateGraph('rttGraph', rttHistoryData, RTT_THRESHOLD * 1.5);

    bitrateInHistoryData.push(callStats.bitrateIn);
    if (bitrateInHistoryData.length > HISTORY_LENGTH) bitrateInHistoryData.shift();
    updateGraph('bitrateInGraph', bitrateInHistoryData, BITRATE_THRESHOLD * 1.5);

    jitterHistoryData.push(callStats.jitter);
    if (jitterHistoryData.length > HISTORY_LENGTH) jitterHistoryData.shift();
    updateGraph('jitterGraph', jitterHistoryData, JITTER_THRESHOLD * 1.5);

    // Update RTT trend
    let rttTrend = calculateRttTrend();
    updateRttTrendDisplay(rttTrend);

    // Toggle warning classes
    toggleClassWarning(rttDisplay.parentElement, callStats.rtt > RTT_THRESHOLD);
    toggleClassWarning(bitrateInDisplay.parentElement, 
                     callStats.bitrateIn < BITRATE_THRESHOLD && callStats.bitrateIn > 0);
    toggleClassWarning(packetsLostDisplay.parentElement, callStats.packetsLost > PACKET_LOSS_THRESHOLD);
    toggleClassWarning(framesDroppedDisplay.parentElement, callStats.framesDropped > FRAME_DROP_THRESHOLD);
    toggleClassWarning(jitterDisplay.parentElement, callStats.jitter > JITTER_THRESHOLD);
}

/**
 * Updates the active network endpoints display
 */
function updateActiveNetworkDisplay(localEndpoint, remoteEndpoint) {
    activeLocalEndpointDisplay.textContent = localEndpoint || 'N/A';
    if (localEndpoint && localEndpoint !== lastLoggedEndpoint) {
        console.log("New active local endpoint:", localEndpoint);
        lastLoggedEndpoint = localEndpoint;
    }
    activeRemoteEndpointDisplay.textContent = remoteEndpoint || 'N/A';
}

/**
 * Updates a simple bar graph element
 */
function updateGraph(graphId, data, maxValue) {
    const graphElement = document.getElementById(graphId);
    if (!graphElement || maxValue <= 0) return;

    let graphHTML = '';
    const barWidthPercent = 100 / Math.max(1, data.length);

    for (let i = 0; i < data.length; i++) {
        const value = Math.max(0, data[i]);
        const heightPercentage = Math.min(100, (value / maxValue) * 100);
        graphHTML += `<div style="width: ${barWidthPercent}%; height: ${heightPercentage}%; 
                        background-color: #3498db; display: inline-block; vertical-align: bottom;"></div>`;
    }
    graphElement.innerHTML = graphHTML;
}

/**
 * Toggles warning class on an element
 */
function toggleClassWarning(element, isWarning) {
    if (!element) return;
    if (isWarning) {
        element.classList.add('warning');
    } else {
        element.classList.remove('warning');
    }
}

// ======================
// Decision Logic
// ======================

/**
 * Calculates RTT trend based on history
 */
function calculateRttTrend() {
    rttHistory.push(callStats.rtt);
    if (rttHistory.length > RTT_TREND_WINDOW) {
        rttHistory.shift();
    }

    if (rttHistory.length < 2) return 0;

    let latestRtt = rttHistory[rttHistory.length - 1];
    let previousRtt = rttHistory[rttHistory.length - 2];
    return latestRtt - previousRtt;
}

/**
 * Updates the RTT trend display
 */
function updateRttTrendDisplay(trend) {
    let trendIndicator = "→ (Stable)";
    let trendColor = "gray";

    if (trend > RTT_TREND_THRESHOLD) {
        trendIndicator = "↑ (Increasing)";
        trendColor = "red";
    } else if (trend < -RTT_TREND_THRESHOLD) {
        trendIndicator = "↓ (Decreasing)";
        trendColor = "green";
    }
    rttTrendDisplay.textContent = trendIndicator;
    rttTrendDisplay.style.color = trendColor;
}

/**
 * Calculates a quality score based on current metrics
 */
function calculateQualityScore() {
    let rttScore = (callStats.rtt / RTT_THRESHOLD) * RTT_WEIGHT;
    let bitrateScore = (BITRATE_THRESHOLD / Math.max(callStats.bitrateIn, 1)) * BITRATE_WEIGHT;
    let packetLossScore = (callStats.packetsLost / PACKET_LOSS_THRESHOLD) * PACKET_LOSS_WEIGHT;
    let frameDropScore = (callStats.framesDropped / FRAME_DROP_THRESHOLD) * FRAME_DROP_WEIGHT;
    let jitterScore = (callStats.jitter / JITTER_THRESHOLD) * JITTER_WEIGHT;
    return rttScore + bitrateScore + packetLossScore + frameDropScore + jitterScore;
}

/**
 * Makes a decision based on current call quality
 */
function makeDecision() {
    if (!isCallActive || isSwitching) return;

    if (!decisionWarmupDone || callStats.bitrateIn === 0 || callStats.frameRate === 0) {
        console.log("Skipping decision during warmup (stats not ready).");
        return;
    }

    let decision = "Stable";
    let reason = "";
    let switchNeeded = false;

    // Check quality metrics
    if (callStats.rtt > 500) { reason += "RTT too high. "; switchNeeded = true; }
    if (callStats.packetsLost > 10) { reason += "High packet loss. "; switchNeeded = true; }
    if (callStats.jitter > 100) { reason += "Jitter unacceptable. "; switchNeeded = true; }
    if (callStats.bitrateIn < 300) { reason += "Low bitrate in. "; switchNeeded = true; }
    if (callStats.downlink < 1) { reason += "Weak downlink (<1Mbps). "; switchNeeded = true; }

    // Check quality score
    const score = calculateQualityScore();
    if (score > 1.5) { reason += `Degradation score ${score.toFixed(2)}. `; switchNeeded = true; }

    // Handle degradation timing
    if (switchNeeded) {
        if (!degradationStartTime) {
            degradationStartTime = Date.now();
            console.log("Degradation started. Timer begins.");
        } else if (Date.now() - degradationStartTime >= MIN_DEGRADATION_DURATION_MS) {
            decision = "Degrading - Switching Path";
            console.log("Switching due to persistent degradation:", reason);
            triggerPathSwitch(reason);
            degradationStartTime = null;
        } else {
            const wait = Math.ceil((MIN_DEGRADATION_DURATION_MS - (Date.now() - degradationStartTime)) / 1000);
            decision = `Degrading – Monitoring (${wait}s left)`;
        }
    } else {
        degradationStartTime = null;
    }

    // Update UI
    decisionDisplay.textContent = `${decision}${reason ? " – " + reason : ""}`;
    qualityScoreDisplay.textContent = score.toFixed(2);

    // Update score color
    qualityScoreDisplay.classList.remove('score-good', 'score-warning', 'score-bad');
    qualityScoreDisplay.classList.add(
        score < 1.0 ? 'score-good' :
        score < 1.5 ? 'score-warning' :
                      'score-bad'
    );
}

/**
 * Triggers a network path switch
 */
function triggerPathSwitch(reasonText) {
    console.log("Proactive ICE restart due to:", reasonText);

    if (!remoteConnection || isSwitching) return;
    isSwitching = true;

    // Remove all tracks
    remoteConnection.getSenders().forEach(sender => {
        remoteConnection.removeTrack(sender);
    });

    // Re-add local tracks
    localStream.getTracks().forEach(track => {
        remoteConnection.addTrack(track, localStream);
    });

    // Restart ICE
    remoteConnection.restartIce();
    socket.emit('restart-ice-request');
    showToast('Switching Network Path...');

    // Reset switching state after timeout
    setTimeout(() => {
        isSwitching = false;
        console.log("Switching cooldown complete.");
    }, 8000);
}

// Initialize threshold displays
updateStatsDisplay();