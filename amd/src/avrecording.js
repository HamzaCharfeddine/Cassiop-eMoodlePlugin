/**
 * JavaScript module for handling audio/video/screen recording in the RecordRTC question type.
 *
 * @package   qtype_recordrtc
 * @copyright 2025 Your Name
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

define([
    'jquery',
    'core/ajax',
    'core/notification',
    'core/str',
    'media_recordrtc/lamejs/lame.all',
    'media_recordrtc/recorder'
], function($, Ajax, Notification, Str, lamejs, RecordRTC) {

    var selectors = {
        widget: '.qtype_recordrtc-audio-widget, .qtype_recordrtc-video-widget, .qtype_recordrtc-screen-widget',
        previewPlaceholder: '.qtype_recordrtc-preview-placeholder',
        noRecordingPlaceholder: '.qtype_recordrtc-no-recording-placeholder',
        mediaPlayer: '.qtype_recordrtc-media-player',
        timeLeft: '.qtype_recordrtc-time-left',
        pauseButton: '.qtype_recordrtc-pause-button',
        finishButton: '.qtype_recordrtc-finish-button',
        reflectionTimer: '.reflection-timer',
        showQuestionButton: '.btn-primary'
    };

    var init = function(config) {
        $(selectors.widget).each(function() {
            var $widget = $(this);
            var mediaType = $widget.data('media-type');
            var widgetName = $widget.data('widget-name');
            var maxDuration = parseInt($widget.data('max-recording-duration'), 10);
            var previewTime = parseInt($widget.data('preview-time'), 10); // reflectiontime used as preview time
            var filename = $widget.data('recording-filename');
            var convertToMp3 = $widget.data('convert-to-mp3') === 1;
            var enableReflection = $widget.data('enablereflection');
            var reflectionTime = parseInt($widget.data('reflectiontime'), 10);

            var recorder = null;
            var stream = null;
            var state = $widget.data('state');
            var recordingTimeout = null;

            // Handle preview phase.
            if (state === 'preview') {
                $widget.find(selectors.previewPlaceholder).text(
                    Str.get_string('previewingquestion', 'qtype_recordrtc', previewTime)
                );
                var previewTimer = setInterval(function() {
                    previewTime--;
                    if (previewTime <= 0) {
                        clearInterval(previewTimer);
                        $widget.find(selectors.previewPlaceholder).addClass('hide');
                        $widget.find(selectors.timeLeft).removeClass('hide');
                        $widget.find(selectors.pauseButton).removeClass('hide');
                        $widget.find(selectors.finishButton).removeClass('hide');
                        startRecording();
                    } else {
                        $widget.find(selectors.previewPlaceholder).text(
                            Str.get_string('previewingquestion', 'qtype_recordrtc', previewTime)
                        );
                    }
                }, 1000);
            }

            // Start recording automatically.
            function startRecording() {
                var constraints = {};
                if (mediaType === 'audio') {
                    constraints = { audio: true };
                } else if (mediaType === 'video') {
                    constraints = { video: true, audio: true };
                } else if (mediaType === 'screen') {
                    constraints = { video: true, audio: true, screen: true };
                }

                navigator.mediaDevices.getUserMedia(constraints).then(function(mediaStream) {
                    stream = mediaStream;
                    recorder = new RecordRTC(mediaStream, {
                        type: mediaType === 'audio' ? 'audio' : 'video',
                        mimeType: mediaType === 'audio' ? 'audio/ogg' : 'video/webm',
                        bitsPerSecond: config[mediaType + 'bitrate'],
                        disableLogs: true
                    });

                    recorder.startRecording();
                    $widget.data('state', 'recording');

                    // Auto-stop after max duration.
                    recordingTimeout = setTimeout(function() {
                        stopRecording(true);
                    }, maxDuration * 1000);

                    // Update progress bar.
                    var timeLeft = maxDuration;
                    var progressInterval = setInterval(function() {
                        timeLeft--;
                        if (timeLeft <= 0) {
                            clearInterval(progressInterval);
                        }
                        var progress = (timeLeft / maxDuration) * 100;
                        $widget.find('.qtype_recordrtc-timer-front').css('width', progress + '%');
                    }, 1000);
                }).catch(function(error) {
                    Notification.exception(error);
                });
            }

            // Stop recording and submit.
            function stopRecording(autoSubmit) {
                if (recorder && recorder.state === 'recording') {
                    recorder.stopRecording(function() {
                        var blob = recorder.getBlob();
                        stream.getTracks().forEach(track => track.stop());
                        clearTimeout(recordingTimeout);

                        if (convertToMp3 && mediaType === 'audio') {
                            convertToMp3AndUpload(blob);
                        } else {
                            uploadFile(blob);
                        }

                        if (enableReflection) {
                            $widget.find(selectors.timeLeft).addClass('hide');
                            $widget.find(selectors.pauseButton).addClass('hide');
                            $widget.find(selectors.finishButton).addClass('hide');
                            $widget.find(selectors.reflectionTimer).removeClass('hide');
                            startReflection();
                        } else if (autoSubmit) {
                            submitAndNext();
                        }
                    });
                }
            }

            // Convert to MP3 and upload.
            function convertToMp3AndUpload(blob) {
                var reader = new FileReader();
                reader.onload = function(event) {
                    var audioContext = new (window.AudioContext || window.webkitAudioContext)();
                    audioContext.decodeAudioData(event.target.result, function(buffer) {
                        var mp3Data = lamejs.Mp3Encoder(1, buffer.sampleRate, 128).encodeBuffer(buffer.getChannelData(0));
                        var mp3Blob = new Blob([mp3Data], { type: 'audio/mp3' });
                        uploadFile(mp3Blob);
                    });
                };
                reader.readAsArrayBuffer(blob);
            }

            // Upload file to Moodle.
            function uploadFile(blob) {
                var formData = new FormData();
                formData.append('file', blob, filename);
                formData.append('contextid', config.contextid);
                formData.append('component', config.component);
                formData.append('filearea', config.filearea);
                formData.append('itemid', config.itemid);

                Ajax.call([{
                    methodname: 'core_files_upload',
                    args: {
                        contextid: config.contextid,
                        component: config.component,
                        filearea: config.filearea,
                        itemid: config.itemid,
                        filepath: '/',
                        filename: filename,
                        filecontent: blob
                    },
                    done: function(response) {
                        $widget.find(selectors.mediaPlayer).removeClass('hide').find('source').attr('src', response.url);
                        $widget.data('state', 'recorded');
                        $widget.find('input[name="' + widgetName + '"]').val(filename);
                    },
                    fail: function(error) {
                        Notification.exception(error);
                    }
                }]);
            }

            // Start reflection phase.
            function startReflection() {
                var timeLeft = reflectionTime;
                $widget.find(selectors.reflectionTimer).text(
                    Str.get_string('reflectiontime_remaining', 'qtype_recordrtc', timeLeft)
                );
                var reflectionInterval = setInterval(function() {
                    timeLeft--;
                    if (timeLeft <= 0) {
                        clearInterval(reflectionInterval);
                        $widget.find(selectors.reflectionTimer).addClass('hide');
                        $widget.find(selectors.showQuestionButton).removeClass('hide').prop('disabled', false);
                    } else {
                        $widget.find(selectors.reflectionTimer).text(
                            Str.get_string('reflectiontime_remaining', 'qtype_recordrtc', timeLeft)
                        );
                    }
                }, 1000);
            }

            // Handle finish button click.
            $widget.find(selectors.finishButton).on('click', function() {
                stopRecording(true);
            });

            // Handle show question button click.
            $widget.find(selectors.showQuestionButton).on('click', function() {
                submitAndNext();
            });

            // Submit and go to next question.
            function submitAndNext() {
                var $form = $widget.closest('form');
                $form.find('input[name="next"]').click();
            }
        });
    };

    return {
        init: init
    };
});