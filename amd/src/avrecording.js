// This file is part of Moodle - http://moodle.org/
//
// Moodle is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// Moodle is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with Moodle.  If not, see <http://www.gnu.org/licenses/>.
//

/**
 * JavaScript to the recording work.
 *
 * We would like to thank the creators of atto_recordrtc, whose
 * work originally inspired this.
 *
 * This script uses some third-party JavaScript and loading that within Moodle/ES6
 * requires some contortions. The main classes here are:
 *
 * * Recorder - represents one recording widget. This works in a way that is
 *   not particularly specific to this question type.
 * * RecordRtcQuestion - represents one question, which may contain several recorders.
 *   It deals with the interaction between the recorders and the question.
 *
 * @module    qtype_recordrtc/avrecording
 * @copyright 2019 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

import Log from 'core/log';
import ModalFactory from 'core/modal_factory';

/**
 * Verify that the question type can work. If not, show a warning.
 *
 * @return {string} 'ok' if it looks OK, else 'nowebrtc' or 'nothttps' if there is a problem.
 */
function checkCanWork() {
    // Check APIs are known.
    if (!(navigator.mediaDevices && window.MediaRecorder)) {
        return 'nowebrtc';
    }

    // Check protocol (localhost).
    if (location.protocol === 'https:' ||
            location.host === 'localhost' || location.host === '127.0.0.1') {
        return 'ok';
    } else {
        return 'nothttps';
    }
}

/**
 * Object for actually doing the recording.
 *
 * The recorder can be in one of several states, which is stored in a data-state
 * attribute on the outer span (widget). The states are:
 *
 *  - preview:   showing question for reflectiontime before recording starts.
 *  - new:       there is no recording yet. Auto-starts recording after preview.
 *  - starting:  (video only) camera has started, but we are not recording yet.
 *  - recording: Media is being recorded. Pause button visible if allowed. Finish button visible.
 *  - paused:    If pause was pressed. Media recording paused, but resumable. Pause button changed to say 'resume'.
 *  - saving:    Media being uploaded. Progress indication shown. Pause button hidden if was visible.
 *  - recorded:  Recording and upload complete. No further attempts allowed.
 *
 * @param {HTMLElement} widget the DOM node that is the top level of the whole recorder.
 * @param {(AudioSettings|VideoSettings)} mediaSettings information about the media type.
 * @param {Object} owner the object we are doing the recording for. Must provide three callback functions
 *                       showAlert notifyRecordingComplete notifyButtonStatesChanged.
 * @param {Object} uploadInfo object with fields uploadRepositoryId, draftItemId, contextId and maxUploadSize.
 * @constructor
 */
function Recorder(widget, mediaSettings, owner, uploadInfo) {
    /**
     * @type {Recorder} reference to this recorder, for use in event handlers.
     */
    const recorder = this;

    /**
     * @type {MediaStream} during recording, the stream of incoming media.
     */
    let mediaStream = null;

    /**
     * @type {MediaRecorder} the recorder that is capturing stream.
     */
    let mediaRecorder = null;

    /**
     * @type {Blob[]} the chunks of data that have been captured so far during the current recording.
     */
    let chunks = [];

    /**
     * @type {number} number of bytes recorded so far, so we can auto-stop
     * before hitting Moodle's file-size limit.
     */
    let bytesRecordedSoFar = 0;

    /**
     * @type {number} when paused, the time left in milliseconds, so we can auto-stop at the time limit.
     */
    let timeRemaining = 0;

    /**
     * @type {number} while recording, the time we reach the time-limit, so we can auto-stop then.
     * This is milliseconds since Unix epoch, so comparable with Date.now().
     */
    let stopTime = 0;

    /**
     * @type {number} intervalID returned by setInterval() while the timer is running.
     */
    let countdownTicker = 0;

    const button = widget.querySelector('button.qtype_recordrtc-main-button');
    const pauseButton = widget.querySelector('.qtype_recordrtc-pause-button button');
    const finishButton = widget.querySelector('.qtype_recordrtc-finish-button button');
    const controlRow = widget.querySelector('.qtype_recordrtc-control-row');
    const mediaElement = widget.querySelector('.qtype_recordrtc-media-player ' +
        (mediaSettings.name === 'screen' ? 'video' : mediaSettings.name));
    const noMediaPlaceholder = widget.querySelector('.qtype_recordrtc-no-recording-placeholder');
    const previewPlaceholder = widget.querySelector('.qtype_recordrtc-preview-placeholder');
    const timeDisplay = widget.querySelector('.qtype_recordrtc-time-left');
    const progressBar = widget.querySelector('.qtype_recordrtc-time-left .qtype_recordrtc-timer-front');
    const backTimeEnd = widget.querySelector('.qtype_recordrtc-time-left .qtype_recordrtc-timer-back span.timer-end');
    const backtimeStart = widget.querySelector('.qtype_recordrtc-time-left .qtype_recordrtc-timer-back span.timer-start');
    const frontTimeEnd = widget.querySelector('.qtype_recordrtc-time-left .qtype_recordrtc-timer-front span.timer-end');
    const fronttimeStart = widget.querySelector('.qtype_recordrtc-time-left .qtype_recordrtc-timer-front span.timer-start');
    const enablereflection = widget.dataset.enablereflection === '1' || widget.dataset.enablereflection === 'true';
    const reflectiontime = parseInt(widget.dataset.previewTime, 10); // Use preview-time (reflectiontime).
    const showQuestionButton = widget.querySelector(`#show-question-button-${widget.dataset.widgetName}`);
    const reflectionTimer = widget.querySelector(`#reflection-timer-${widget.dataset.widgetName}`);

    widget.addEventListener('click', handleButtonClick);
    this.uploadMediaToServer = uploadMediaToServer; // Make this method available.

    // Handle preview phase automatically.
    if (widget.dataset.state === 'preview') {
        startPreview();
    }

    if (enablereflection) {
        setupReflection();
    }

    /**
     * Start the preview phase with a countdown.
     */
    function startPreview() {
        let timeLeft = reflectiontime;
        previewPlaceholder.classList.remove('hide');
        previewPlaceholder.textContent = M.util.get_string('previewingquestion', 'qtype_recordrtc', timeLeft);

        const previewInterval = setInterval(function() {
            timeLeft--;
            if (timeLeft <= 0) {
                clearInterval(previewInterval);
                previewPlaceholder.classList.add('hide');
                timeDisplay.classList.remove('hide');
                if (pauseButton) pauseButton.parentElement.classList.remove('hide');
                if (finishButton) finishButton.parentElement.classList.remove('hide');
                widget.dataset.state = 'new';
                startRecording();
            } else {
                previewPlaceholder.textContent = M.util.get_string('previewingquestion', 'qtype_recordrtc', timeLeft);
            }
        }, 1000);
    }

    /**
     * Setup reflection phase (if enabled).
     */
    function setupReflection() {
        if (!showQuestionButton || !reflectionTimer) {
            console.warn(`Recorder for widget ${widget.dataset.widgetName} is missing reflection elements.`);
            return;
        }

        showQuestionButton.disabled = true;
        showQuestionButton.addEventListener('click', function(e) {
            e.preventDefault();
            submitAndNext();
        });
    }

    /**
     * Handle reflection countdown after recording.
     */
    function startReflection() {
        reflectionTimer.style.display = 'block';
        let timeLeft = reflectiontime;
        reflectionTimer.textContent = M.util.get_string('reflectiontime_remaining', 'qtype_recordrtc', timeLeft);

        const countdown = setInterval(function() {
            timeLeft--;
            if (timeLeft > 0) {
                reflectionTimer.textContent = M.util.get_string('reflectiontime_remaining', 'qtype_recordrtc', timeLeft);
            } else {
                clearInterval(countdown);
                reflectionTimer.style.display = 'none';
                showQuestionButton.disabled = false;
                showQuestionButton.classList.remove('hide');
            }
        }, 1000);
    }

    /**
     * Handle button clicks.
     *
     * @param {Event} e
     */
    function handleButtonClick(e) {
        const clickedButton = e.target.closest('button');
        if (!clickedButton) {
            return;
        }
        e.preventDefault();
        switch (widget.dataset.state) {
            case 'recorded':
                // No further attempts allowed.
                break;
            case 'starting':
                if (mediaSettings.name === 'screen') {
                    startScreenSaving();
                } else {
                    startSaving();
                }
                break;
            case 'recording':
                if (clickedButton === pauseButton) {
                    pause();
                } else if (clickedButton === finishButton) {
                    stopRecording(true);
                }
                break;
            case 'paused':
                if (clickedButton === pauseButton) {
                    resume();
                } else if (clickedButton === finishButton) {
                    stopRecording(true);
                }
                break;
        }
    }

    /**
     * Handle screen sharing errors.
     *
     * @param {Object} error
     */
    function handleScreenSharingError(error) {
        Log.debug(error);
        startSaving();
    }

    /**
     * Start screen recording with audio.
     */
    function startScreenSaving() {
        navigator.mediaDevices.enumerateDevices().then(() => {
            return navigator.mediaDevices.getUserMedia({audio: true});
        }).then(micStream => {
            let composedStream = new MediaStream();
            mediaStream.getTracks().forEach(function(track) {
                if (track.kind === 'video') {
                    composedStream.addTrack(track);
                } else {
                    track.stop();
                }
            });
            micStream.getAudioTracks().forEach(function(micTrack) {
                composedStream.addTrack(micTrack);
            });
            mediaStream = composedStream;
            startSaving();
            return true;
        }).catch(handleScreenSharingError);
    }

    /**
     * Start recording.
     */
    function startRecording() {
        setLabelForTimer(0, parseInt(widget.dataset.maxRecordingDuration));

        if (mediaSettings.name === 'audio') {
            mediaElement.parentElement.classList.add('hide');
            noMediaPlaceholder.classList.add('hide');
            timeDisplay.classList.remove('hide');
        } else {
            mediaElement.parentElement.classList.remove('hide');
            noMediaPlaceholder.classList.add('hide');
        }

        disableAllButtons();

        chunks = [];
        bytesRecordedSoFar = 0;
        if (mediaSettings.name === 'screen') {
            navigator.mediaDevices.getDisplayMedia(mediaSettings.mediaConstraints)
                .then(handleCaptureStarting)
                .catch(handleCaptureFailed);
        } else {
            navigator.mediaDevices.getUserMedia(mediaSettings.mediaConstraints)
                .then(handleCaptureStarting)
                .catch(handleCaptureFailed);
        }
    }

    /**
     * Handle media capture start.
     *
     * @param {MediaStream} stream
     */
    function handleCaptureStarting(stream) {
        mediaStream = stream;

        mediaElement.srcObject = stream;
        mediaElement.muted = true;
        if (mediaSettings.name === 'audio') {
            startSaving();
        } else {
            if (mediaSettings.name === 'screen') {
                mediaStream.getVideoTracks()[0].addEventListener('ended', handleStopSharing);
            }
            mediaElement.play();
            mediaElement.controls = false;

            widget.dataset.state = 'starting';
            widget.querySelector('.qtype_recordrtc-stop-button').disabled = false;
        }

        if (pauseButton) {
            pauseButton.disabled = false;
        }
        if (finishButton) {
            finishButton.disabled = false;
        }
    }

    /**
     * Start saving the recording.
     */
    function startSaving() {
        mediaRecorder = new MediaRecorder(mediaStream, getRecordingOptions());

        mediaRecorder.ondataavailable = handleDataAvailable;
        mediaRecorder.onpause = handleDataAvailable;
        mediaRecorder.onstop = handleRecordingHasStopped;
        mediaRecorder.start(1000);

        widget.dataset.state = 'recording';
        progressBar.style.animationDuration = widget.dataset.maxRecordingDuration + 's';
        progressBar.classList.add('animate');
        startCountdownTimer();
        if (mediaSettings.name === 'video' || mediaSettings.name === 'screen') {
            controlRow.classList.remove('hide');
            controlRow.classList.add('d-flex');
            timeDisplay.classList.remove('hide');
        }
    }

    /**
     * Handle stop sharing for screen recording.
     */
    function handleStopSharing() {
        if (widget.dataset.state === 'starting') {
            widget.dataset.state = 'new';
            mediaElement.parentElement.classList.add('hide');
            noMediaPlaceholder.classList.remove('hide');
            enableAllButtons();
        } else {
            const controlEl = widget.querySelector('.qtype_recordrtc-control-row');
            if (!controlEl.classList.contains('hide')) {
                stopRecording(true);
            }
        }
    }

    /**
     * Handle data available from recorder.
     *
     * @param {BlobEvent} event
     */
    function handleDataAvailable(event) {
        if (!event.data) {
            return;
        }

        bytesRecordedSoFar += event.data.size;
        if (uploadInfo.maxUploadSize >= 0 && bytesRecordedSoFar >= uploadInfo.maxUploadSize) {
            if (!localStorage.getItem('alerted')) {
                localStorage.setItem('alerted', 'true');
                stopRecording(false);
                owner.showAlert('nearingmaxsize');
            } else {
                localStorage.removeItem('alerted');
            }
        }

        chunks.push(event.data);

        if (typeof M.core_formchangechecker !== 'undefined' &&
            !window.location.pathname.endsWith('/question/preview.php')) {
            M.core_formchangechecker.set_form_changed();
        }
    }

    /**
     * Pause recording.
     */
    function pause() {
        stopCountdownTimer();
        setPauseButtonLabel('resume');
        mediaRecorder.pause();
        widget.dataset.state = 'paused';
        toggleProgressbarState();
    }

    /**
     * Resume recording.
     */
    function resume() {
        resumeCountdownTimer();
        widget.dataset.state = 'recording';
        setPauseButtonLabel('pause');
        mediaRecorder.resume();
        toggleProgressbarState();
    }

    /**
     * Stop recording.
     *
     * @param {boolean} autoSubmit whether to submit and move to next question.
     */
    function stopRecording(autoSubmit) {
        if (pauseButton) {
            pauseButton.disabled = true;
        }
        if (finishButton) {
            finishButton.disabled = true;
        }

        stopCountdownTimer();

        if (pauseButton) {
            setPauseButtonLabel('pause');
            pauseButton.parentElement.classList.add('hide');
        }
        if (finishButton) {
            finishButton.parentElement.classList.add('hide');
        }

        progressBar.style.animationPlayState = 'running';
        progressBar.classList.remove('animate');

        mediaRecorder.stop();

        const tracks = mediaStream.getTracks();
        for (let i = 0; i < tracks.length; i++) {
            tracks[i].stop();
        }

        if (autoSubmit && !enablereflection) {
            submitAndNext();
        }
    }

    /**
     * Handle recording stop.
     */
    function handleRecordingHasStopped() {
        if (widget.dataset.state === 'new') {
            return;
        }

        const blob = new Blob(chunks, {type: mediaRecorder.mimeType});
        mediaElement.srcObject = null;
        mediaElement.src = URL.createObjectURL(blob);

        mediaElement.muted = false;
        mediaElement.controls = true;
        mediaElement.parentElement.classList.remove('hide');
        noMediaPlaceholder.classList.add('hide');
        mediaElement.focus();

        if (mediaSettings.name === 'audio') {
            timeDisplay.classList.add('hide');
        } else {
            controlRow.classList.add('hide');
            controlRow.classList.remove('d-flex');
        }

        widget.dataset.state = 'recorded';

        if (chunks.length > 0) {
            owner.notifyRecordingComplete(recorder);
            if (enablereflection) {
                startReflection();
            }
        }
    }

    /**
     * Handle capture failure.
     *
     * @param {DOMException} error
     */
    function handleCaptureFailed(error) {
        Log.debug('Audio/video/screen question: error received');
        Log.debug(error);

        setPlaceholderMessage('recordingfailed');
        widget.dataset.state = 'new';
        timeDisplay.classList.add('hide');

        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }

        const stringName = 'gum' + error.name.replace('Error', '').toLowerCase();
        owner.showAlert(stringName);
        enableAllButtons();
    }

    /**
     * Start countdown timer.
     */
    function startCountdownTimer() {
        timeRemaining = widget.dataset.maxRecordingDuration * 1000;
        resumeCountdownTimer();
        updateTimerDisplay();
    }

    /**
     * Stop countdown timer.
     */
    function stopCountdownTimer() {
        timeRemaining = stopTime - Date.now();
        if (countdownTicker !== 0) {
            clearInterval(countdownTicker);
            countdownTicker = 0;
        }
    }

    /**
     * Resume countdown timer.
     */
    function resumeCountdownTimer() {
        stopTime = Date.now() + timeRemaining;
        if (countdownTicker === 0) {
            countdownTicker = setInterval(updateTimerDisplay, 100);
        }
    }

    /**
     * Update timer display.
     */
    function updateTimerDisplay() {
        const millisecondsRemaining = stopTime - Date.now();
        const secondsRemaining = Math.round(millisecondsRemaining / 1000);
        const secondsStart = widget.dataset.maxRecordingDuration - secondsRemaining;
        setLabelForTimer(secondsStart, secondsRemaining);
        if (millisecondsRemaining <= 0) {
            stopRecording(true);
        }
    }

    /**
     * Get time label for timer.
     *
     * @param {number} seconds
     * @return {string}
     */
    function getTimeLabelForTimer(seconds) {
        const secs = seconds % 60;
        const mins = Math.round((seconds - secs) / 60);
        return M.util.get_string('timedisplay', 'qtype_recordrtc', {mins: pad(mins), secs: pad(secs)});
    }

    /**
     * Set time label for timer.
     *
     * @param {Number} secondsStart
     * @param {Number} secondsRemaining
     */
    function setLabelForTimer(secondsStart, secondsRemaining) {
        backTimeEnd.innerText = getTimeLabelForTimer(secondsRemaining);
        backtimeStart.innerText = getTimeLabelForTimer(secondsStart);
        frontTimeEnd.innerText = getTimeLabelForTimer(secondsRemaining);
        fronttimeStart.innerText = getTimeLabelForTimer(secondsStart);
    }

    /**
     * Pad number to two digits.
     *
     * @param {number} val
     * @return {string}
     */
    function pad(val) {
        const valString = val + '';
        return valString.length < 2 ? '0' + valString : '' + valString;
    }

    /**
     * Upload media to server.
     */
    async function uploadMediaToServer() {
        setButtonLabel('uploadpreparing');

        if (widget.dataset.convertToMp3) {
            const mp3DataBlob = await convertOggToMp3(mediaElement.src);
            mediaElement.src = URL.createObjectURL(mp3DataBlob);
            uploadBlobToRepository(mp3DataBlob, widget.dataset.recordingFilename.replace(/\.ogg$/, '.mp3'));
        } else {
            const oggDataBlob = await fetchOggData(mediaElement.src, 'blob');
            uploadBlobToRepository(oggDataBlob, widget.dataset.recordingFilename);
        }
    }

    /**
     * Convert Ogg to MP3.
     *
     * @param {string} sourceUrl
     * @returns {Promise<Blob>}
     */
    async function convertOggToMp3(sourceUrl) {
        const lamejs = await getLameJs();
        const oggData = await fetchOggData(sourceUrl, 'arraybuffer');
        const audioBuffer = await (new AudioContext()).decodeAudioData(oggData);
        const [left, right] = getRawAudioDataFromBuffer(audioBuffer);
        return await createMp3(lamejs, audioBuffer.numberOfChannels, audioBuffer.sampleRate, left, right);
    }

    /**
     * Load lamejs library.
     *
     * @returns {Promise<*>}
     */
    async function getLameJs() {
        return await import(M.cfg.wwwroot + '/question/type/recordrtc/js/lamejs@1.2.1a-7-g582bbba/lame.min.js');
    }

    /**
     * Fetch Ogg data.
     *
     * @param {string} sourceUrl
     * @param {XMLHttpRequestResponseType} responseType
     * @returns {Promise<ArrayBuffer|Blob>}
     */
    function fetchOggData(sourceUrl, responseType) {
        return new Promise((resolve) => {
            const fetchRequest = new XMLHttpRequest();
            fetchRequest.open('GET', sourceUrl);
            fetchRequest.responseType = responseType;
            fetchRequest.addEventListener('load', () => {
                resolve(fetchRequest.response);
            });
            fetchRequest.send();
        });
    }

    /**
     * Get raw audio data from buffer.
     *
     * @param {AudioBuffer} audioIn
     * @returns {Int16Array[]}
     */
    function getRawAudioDataFromBuffer(audioIn) {
        const channelData = [];
        for (let channel = 0; channel < audioIn.numberOfChannels; channel++) {
            const rawChannelData = audioIn.getChannelData(channel);
            channelData[channel] = new Int16Array(audioIn.length);
            for (let i = 0; i < audioIn.length; i++) {
                channelData[channel][i] = rawChannelData[i] * 0x7FFF;
            }
        }
        return channelData;
    }

    /**
     * Create MP3 from audio data.
     *
     * @param {*} lamejs
     * @param {int} channels
     * @param {int} sampleRate
     * @param {Int16Array} left
     * @param {Int16Array|null} right
     * @returns {Blob}
     */
    async function createMp3(lamejs, channels, sampleRate, left, right = null) {
        const buffer = [];
        const mp3enc = new lamejs.Mp3Encoder(channels, sampleRate, mediaSettings.bitRate / 1000);
        let remaining = left.length;
        const samplesPerFrame = 1152;
        let mp3buf;

        await setPreparingPercent(0, left.length);
        for (let i = 0; remaining >= samplesPerFrame; i += samplesPerFrame) {
            if (channels === 1) {
                const mono = left.subarray(i, i + samplesPerFrame);
                mp3buf = mp3enc.encodeBuffer(mono);
            } else {
                const leftChunk = left.subarray(i, i + samplesPerFrame);
                const rightChunk = right.subarray(i, i + samplesPerFrame);
                mp3buf = mp3enc.encodeBuffer(leftChunk, rightChunk);
            }
            if (mp3buf.length > 0) {
                buffer.push(mp3buf);
            }
            remaining -= samplesPerFrame;
            if (i % (10 * samplesPerFrame) === 0) {
                await setPreparingPercent(i, left.length);
            }
        }
        const d = mp3enc.flush();
        if (d.length > 0) {
            buffer.push(new Int8Array(d));
        }
        await setPreparingPercent(left.length, left.length);

        return new Blob(buffer, {type: "audio/mp3"});
    }

    /**
     * Set upload progress percentage.
     *
     * @param {number} current
     * @param {number} total
     */
    async function setPreparingPercent(current, total) {
        setButtonLabel('uploadpreparingpercent', Math.round(100 * current / total));
        await new Promise(resolve => requestAnimationFrame(resolve));
    }

    /**
     * Upload blob to repository.
     *
     * @param {Blob} blob
     * @param {string} recordingFilename
     */
    function uploadBlobToRepository(blob, recordingFilename) {
        const formData = new FormData();
        formData.append('repo_upload_file', blob, recordingFilename);
        formData.append('sesskey', M.cfg.sesskey);
        formData.append('repo_id', uploadInfo.uploadRepositoryId);
        formData.append('itemid', uploadInfo.draftItemId);
        formData.append('savepath', '/');
        formData.append('ctx_id', uploadInfo.contextId);
        formData.append('overwrite', '1');

        const uploadRequest = new XMLHttpRequest();
        uploadRequest.addEventListener('readystatechange', handleUploadReadyStateChanged);
        uploadRequest.upload.addEventListener('progress', handleUploadProgress);
        uploadRequest.addEventListener('error', handleUploadError);
        uploadRequest.addEventListener('abort', handleUploadAbort);
        uploadRequest.open('POST', M.cfg.wwwroot + '/repository/repository_ajax.php?action=upload');
        uploadRequest.send(formData);
    }

    /**
     * Handle upload completion.
     *
     * @param {ProgressEvent} e
     */
    function handleUploadReadyStateChanged(e) {
        const uploadRequest = e.target;
        if (uploadRequest.readyState !== 4) {
            return;
        }

        const response = JSON.parse(uploadRequest.responseText);
        if (response.errorcode) {
            handleUploadError();
        }

        if (uploadRequest.status === 200) {
            enableAllButtons();
            widget.querySelector('input[name="' + widget.dataset.widgetName + '"]').value = recordingFilename;
        } else if (uploadRequest.status === 404) {
            setPlaceholderMessage('uploadfailed404');
            enableAllButtons();
        }
    }

    /**
     * Handle upload progress.
     *
     * @param {ProgressEvent} e
     */
    function handleUploadProgress(e) {
        setButtonLabel('uploadprogress', Math.round(e.loaded / e.total * 100) + '%');
    }

    /**
     * Handle upload error.
     */
    function handleUploadError() {
        setPlaceholderMessage('uploadfailed');
        enableAllButtons();
    }

    /**
     * Handle upload abort.
     */
    function handleUploadAbort() {
        setPlaceholderMessage('uploadaborted');
        enableAllButtons();
    }

    /**
     * Set button label.
     *
     * @param {string} langString
     * @param {string|null} [a]
     */
    function setButtonLabel(langString, a) {
        if (a === undefined) {
            a = '<span class="sr-only"> ' + widget.dataset.widgetName + '</span>';
        }
        if (button) {
            button.innerHTML = M.util.get_string(langString, 'qtype_recordrtc', a);
        }
    }

    /**
     * Set pause button label.
     *
     * @param {string} langString
     */
    function setPauseButtonLabel(langString) {
        if (pauseButton) {
            pauseButton.innerText = M.util.get_string(langString, 'qtype_recordrtc');
        }
    }

    /**
     * Set placeholder message.
     *
     * @param {string} langString
     */
    function setPlaceholderMessage(langString) {
        noMediaPlaceholder.textContent = M.util.get_string(langString, 'qtype_recordrtc');
        mediaElement.parentElement.classList.add('hide');
        noMediaPlaceholder.classList.remove('hide');
    }

    /**
     * Get recording options.
     *
     * @returns {Object}
     */
    function getRecordingOptions() {
        const options = {};

        if (mediaSettings.name === 'audio') {
            options.audioBitsPerSecond = mediaSettings.bitRate;
        } else if (mediaSettings.name === 'video' || mediaSettings.name === 'screen') {
            options.videoBitsPerSecond = mediaSettings.bitRate;
            options.videoWidth = mediaSettings.width;
            options.videoHeight = mediaSettings.height;

            for (let i = 0; i < mediaSettings.mimeTypes.length; i++) {
                if (MediaRecorder.isTypeSupported(mediaSettings.mimeTypes[i])) {
                    options.mimeType = mediaSettings.mimeTypes[i];
                    break;
                }
            }
        }

        return options;
    }

    /**
     * Enable all buttons.
     */
    function enableAllButtons() {
        disableOrEnableButtons(true);
        owner.notifyButtonStatesChanged();
    }

    /**
     * Disable all buttons.
     */
    function disableAllButtons() {
        disableOrEnableButtons(false);
    }

    /**
     * Disable or enable buttons.
     *
     * @param {boolean} enabled
     */
    function disableOrEnableButtons(enabled = false) {
        document.querySelectorAll('.que.recordrtc').forEach(record => {
            record.querySelectorAll('button, input[type=submit], input[type=button]').forEach(button => {
                button.disabled = !enabled;
            });
        });
    }

    /**
     * Toggle progress bar state.
     */
    function toggleProgressbarState() {
        const running = progressBar.style.animationPlayState || 'running';
        progressBar.style.animationPlayState = running === 'running' ? 'paused' : 'running';
    }

    /**
     * Submit and go to next question.
     */
    function submitAndNext() {
        const form = widget.closest('form');
        const nextButton = form.querySelector('input[name="next"]');
        if (nextButton) {
            nextButton.click();
        }
    }
}

/**
 * Object that controls the settings for recording audio.
 *
 * @param {string} bitRate desired audio bitrate.
 * @constructor
 */
function AudioSettings(bitRate) {
    this.name = 'audio';
    this.bitRate = parseInt(bitRate, 10);
    this.mediaConstraints = {
        audio: true
    };
    this.mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus'
    ];
}

/**
 * Object that controls the settings for recording video.
 *
 * @param {string} bitRate desired video bitrate.
 * @param {string} width desired width.
 * @param {string} height desired height.
 * @constructor
 */
function VideoSettings(bitRate, width, height) {
    this.name = 'video';
    this.bitRate = parseInt(bitRate, 10);
    this.width = parseInt(width, 10);
    this.height = parseInt(height, 10);
    this.mediaConstraints = {
        audio: true,
        video: {
            width: {ideal: this.width},
            height: {ideal: this.height}
        }
    };
    this.mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=h264,opus',
        'video/webm;codecs=vp8,opus'
    ];
}

/**
 * Object that controls the settings for recording screen.
 *
 * @param {string} bitRate desired screen bitrate.
 * @param {string} width desired width.
 * @param {string} height desired height.
 * @constructor
 */
function ScreenSettings(bitRate, width, height) {
    this.name = 'screen';
    this.bitRate = parseInt(bitRate, 10);
    this.width = parseInt(width, 10);
    this.height = parseInt(height, 10);
    this.mediaConstraints = {
        audio: true,
        systemAudio: 'exclude',
        video: {
            displaySurface: 'monitor',
            frameRate: {ideal: 24},
            width: {max: this.width},
            height: {max: this.height},
        }
    };

    this.mimeTypes = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=h264,opus',
    ];
}

/**
 * Represents one record audio or video question.
 *
 * @param {string} questionId id of the outer question div.
 * @param {Object} settings like audio bit rate.
 * @constructor
 */
function RecordRtcQuestion(questionId, settings) {
    const questionDiv = document.getElementById(questionId);

    const result = checkCanWork();
    if (result === 'nothttps') {
        questionDiv.querySelector('.https-warning').classList.remove('hide');
        return;
    } else if (result === 'nowebrtc') {
        questionDiv.querySelector('.no-webrtc-warning').classList.remove('hide');
        return;
    }

    this.showAlert = showAlert;
    this.notifyRecordingComplete = notifyRecordingComplete;
    this.notifyButtonStatesChanged = setSubmitButtonState;
    const thisQuestion = this;

    questionDiv.querySelectorAll('.qtype_recordrtc-audio-widget, .qtype_recordrtc-video-widget, .qtype_recordrtc-screen-widget')
        .forEach(function(widget) {
            let typeInfo;
            switch (widget.dataset.mediaType) {
                case 'audio':
                    typeInfo = new AudioSettings(settings.audioBitRate);
                    break;
                case 'screen':
                    typeInfo = new ScreenSettings(settings.screenBitRate, settings.screenWidth, settings.screenHeight);
                    break;
                default:
                    typeInfo = new VideoSettings(settings.videoBitRate, settings.videoWidth, settings.videoHeight);
                    break;
            }

            new Recorder(widget, typeInfo, thisQuestion, settings);
            return 'Not used';
        });
    setSubmitButtonState();

    /**
     * Set submit button state.
     */
    function setSubmitButtonState() {
        let anyRecorded = false;
        questionDiv.querySelectorAll('.qtype_recordrtc-audio-widget, .qtype_recordrtc-video-widget, .qtype_recordrtc-screen-widget')
            .forEach(function(widget) {
                if (widget.dataset.state === 'recorded') {
                    anyRecorded = true;
                }
            });
        const submitButton = questionDiv.querySelector('input.submit[type=submit]');
        if (submitButton) {
            submitButton.disabled = !anyRecorded;
        }
    }

    /**
     * Show alert modal.
     *
     * @param {string} subject
     * @return {Promise}
     */
    function showAlert(subject) {
        return ModalFactory.create({
            type: ModalFactory.types.ALERT,
            title: M.util.get_string(subject + '_title', 'qtype_recordrtc'),
            body: M.util.get_string(subject, 'qtype_recordrtc'),
        }).then(function(modal) {
            modal.show();
            return modal;
        });
    }

    /**
     * Notify recording completion.
     *
     * @param {Recorder} recorder
     */
    function notifyRecordingComplete(recorder) {
        recorder.uploadMediaToServer();
    }
}

/**
 * Initialise a record audio or video question.
 *
 * @param {string} questionId id of the outer question div.
 * @param {Object} settings like audio bit rate.
 */
function init(questionId, settings) {
    M.util.js_pending('init-' + questionId);
    new RecordRtcQuestion(questionId, settings);
    M.util.js_complete('init-' + questionId);
}

export {
    init
};