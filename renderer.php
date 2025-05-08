<?php
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

/**
 * Renderer for the RecordRTC question type.
 *
 * @package   qtype_recordrtc
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

namespace qtype_recordrtc;

use qtype_recordrtc\output\audio_playback;
use qtype_recordrtc\output\audio_recorder;
use qtype_recordrtc\output\screen_playback;
use qtype_recordrtc\output\screen_recorder;
use qtype_recordrtc\output\video_playback;
use qtype_recordrtc\output\video_recorder;
use question_attempt;
use question_display_options;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/question/type/rendererbase.php');

/**
 * Renderer class for the RecordRTC question type.
 *
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class renderer extends \qtype_renderer {

    public function formulation_and_controls(question_attempt $qa, question_display_options $options) {
        $question = $qa->get_question();
        $result = '';

        $result .= $this->cannot_work_warnings();

        if ($question->enablereflection) {
            $result .= html_writer::tag('p', get_string('reflectioninstructions', 'qtype_recordrtc'));
        }

        $questiontext = $question->format_questiontext($qa);
        $hasrecording = false;
        foreach ($question->widgets as $widget) {
            $placeholder = ':' . $widget->name;
            if (!str_contains($questiontext, $placeholder)) {
                continue;
            }

            $widgethtml = '';
            if ($options->readonly || $qa->get_state()->is_finished()) {
                $playback = $this->get_playback($qa, $widget, $question, $options);
                $widgethtml = $this->render($playback);
                if ($playback->recordingurl) {
                    $hasrecording = true;
                }
            } else {
                // Check if an attempt has already been made.
                $attemptstate = $qa->get_step(0)->get_qt_var('_' . $widget->name);
                if ($attemptstate == 1) {
                    // An attempt has been made, show playback only.
                    $playback = $this->get_playback($qa, $widget, $question, $options);
                    $widgethtml = $this->render($playback);
                    $hasrecording = true;
                } else {
                    $recorder = $this->get_recorder($qa, $widget, $question);
                    $widgethtml = $this->render($recorder);
                }
            }
            $questiontext = str_replace($placeholder, $widgethtml, $questiontext);
        }

        $result .= html_writer::tag('div', $questiontext, ['class' => 'qtext']);

        if (!$options->readonly && !$qa->get_state()->is_finished() && !$hasrecording) {
            $this->page->requires->js_call_amd('qtype_recordrtc/avrecording', 'init', [
                'contextid' => $question->context->id,
                'component' => 'question',
                'filearea' => 'response_recording',
                'itemid' => $question->id,
                'audiobitrate' => (int) get_config('qtype_recordrtc', 'audiobitrate'),
                'videobitrate' => (int) get_config('qtype_recordrtc', 'videobitrate'),
                'screenbitrate' => (int) get_config('qtype_recordrtc', 'screenbitrate'),
                'timelimit' => $question->timelimitinseconds,
                'previewtime' => $question->reflectiontime // Use reflectiontime as preview time.
            ]);
        }

        if ($question->canselfrate || $question->canselfcomment) {
            $result .= $this->render_self_assessment($qa, $options);
        }

        return $result;
    }

    /**
     * Get the recorder object for a given widget.
     *
     * @param question_attempt $qa The question attempt.
     * @param widget_info $widget The widget info.
     * @param qtype_recordrtc_question $question The question.
     * @return audio_recorder|video_recorder|screen_recorder The recorder object.
     */
    protected function get_recorder(question_attempt $qa, widget_info $widget, qtype_recordrtc_question $question) {
        $filename = qtype_recordrtc::get_media_filename($widget->name, $question->mediatype);
        $recordingurl = null;
        if ($file = $question->get_file_from_response($qa->get_last_qt_data(), $widget->name)) {
            $recordingurl = moodle_url::make_pluginfile_url(
                $question->context->id,
                'question',
                'response_recording',
                $question->id,
                '/',
                $file->get_filename()
            );
        }
        $candownload = has_capability('qtype/recordrtc:downloadrecordings', $question->context);
        switch ($widget->type) {
            case 'audio':
                return new audio_recorder(
                    $filename,
                    $question->timelimitinseconds,
                    $question->allowpausing,
                    $recordingurl,
                    $candownload,
                    $question->enablereflection,
                    $question->reflectiontime
                );
            case 'video':
                return new video_recorder(
                    $filename,
                    $question->timelimitinseconds,
                    $question->allowpausing,
                    $recordingurl,
                    $candownload,
                    $question->enablereflection,
                    $question->reflectiontime
                );
            case 'screen':
                return new screen_recorder(
                    $filename,
                    $question->timelimitinseconds,
                    $question->allowpausing,
                    $recordingurl,
                    $candownload,
                    $question->enablereflection,
                    $question->reflectiontime
                );
            default:
                throw new coding_exception('Unknown widget type: ' . $widget->type);
        }
    }

    /**
     * Get the playback object for a given widget.
     *
     * @param question_attempt $qa The question attempt.
     * @param widget_info $widget The widget info.
     * @param qtype_recordrtc_question $question The question.
     * @param question_display_options $options The display options.
     * @return audio_playback|video_playback|screen_playback The playback object.
     */
    protected function get_playback(question_attempt $qa, widget_info $widget, qtype_recordrtc_question $question, question_display_options $options) {
        $filename = qtype_recordrtc::get_media_filename($widget->name, $question->mediatype);
        $recordingurl = null;
        if ($options->readonly && ($file = $question->get_file_from_response($qa->get_last_qt_data(), $widget->name))) {
            $recordingurl = moodle_url::make_pluginfile_url(
                $question->context->id,
                'question',
                'response_recording',
                $question->id,
                '/',
                $file->get_filename()
            );
        }
        $candownload = has_capability('qtype/recordrtc:downloadrecordings', $question->context);
        switch ($widget->type) {
            case 'audio':
                return new audio_playback($filename, $recordingurl, $candownload, $question->enablereflection, $question->reflectiontime);
            case 'video':
                return new video_playback($filename, $recordingurl, $candownload, $question->enablereflection, $question->reflectiontime);
            case 'screen':
                return new screen_playback($filename, $recordingurl, $candownload, $question->enablereflection, $question->reflectiontime);
            default:
                throw new coding_exception('Unknown widget type: ' . $widget->type);
        }
    }

    public function cannot_work_warnings() {
        return $this->render_from_template('qtype_recordrtc/cannot_work_warnings', []);
    }
}