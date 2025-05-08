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
 * Question type class for the RecordRTC question type.
 *
 * @package   qtype_recordrtc
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

use qtype_recordrtc\widget_info;

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/question/type/questionbase.php');

/**
 * Represents a RecordRTC question.
 *
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_recordrtc_question extends question_with_responses {
    use question_with_self_assessment;

    /** @var string Either audio, video or customav. */
    public $mediatype;

    /** @var int Recording time limit, in seconds. */
    public $timelimitinseconds;

    /** @var bool Whether the student can pause the recording part-way through. */
    public $allowpausing;

    /** @var bool Whether the student can rate their response. */
    public $canselfrate;

    /** @var bool Whether the student can comment on their response. */
    public $canselfcomment;

    /** @var bool Whether reflection is enabled. */
    public $enablereflection;

    /** @var int Reflection and preview time in seconds. */
    public $reflectiontime;

    /** @var widget_info[] List of the widgets in the question text. */
    public $widgets;

    public function make_behaviour(question_attempt $qa, $preferredbehaviour) {
        if ($preferredbehaviour === 'selfassess' && ($this->canselfrate || $this->canselfcomment)) {
            return question_engine::make_behaviour('selfassess', $qa, $preferredbehaviour);
        }
        return parent::make_behaviour($qa, $preferredbehaviour);
    }

    public function get_expected_data() {
        $expected = [];
        foreach ($this->widgets as $widget) {
            $expected[$widget->name] = PARAM_FILE;
        }
        if ($this->canselfrate) {
            $expected['selfrating'] = PARAM_INT;
        }
        if ($this->canselfcomment) {
            $expected['selfcomment'] = PARAM_CLEANHTML;
        }
        return $expected;
    }

    public function start_attempt(question_attempt_step $step, $variant) {
        foreach ($this->widgets as $widget) {
            $step->set_qt_var('_' . $widget->name, 0); // Track attempt state (0 = no attempt yet).
        }
    }

    public function is_complete_response(array $response) {
        foreach ($this->widgets as $widget) {
            if ($this->get_file_from_response($response, $widget->name)) {
                return true; // A file exists, response is complete.
            }
        }
        return false;
    }

    public function is_gradable_response(array $response) {
        return $this->is_complete_response($response);
    }

    public function get_validation_error(array $response) {
        if ($this->is_complete_response($response)) {
            return '';
        }
        return get_string('pleasecompleteallrecordings', 'qtype_recordrtc');
    }

    public function is_same_response(array $prevresponse, array $newresponse) {
        foreach ($this->widgets as $widget) {
            $prevfile = $this->get_file_from_response($prevresponse, $widget->name);
            $newfile = $this->get_file_from_response($newresponse, $widget->name);
            if ($prevfile && $newfile) {
                return $prevfile->get_contenthash() === $newfile->get_contenthash();
            }
            if ($prevfile || $newfile) {
                return false;
            }
        }
        return true;
    }

    public function summarise_response(array $response) {
        $summary = [];
        foreach ($this->widgets as $widget) {
            if ($file = $this->get_file_from_response($response, $widget->name)) {
                $summary[] = $widget->name . ': ' . $file->get_filename();
            }
        }
        return implode('; ', $summary);
    }

    public function get_correct_response() {
        return [];
    }

    public function check_file_access($qa, $options, $component, $filearea, $args, $forcedownload) {
        if ($component == 'question' && $filearea == 'response_recording') {
            $questionid = reset($args);
            if ($questionid != $this->id) {
                return false;
            }
            $filename = end($args);
            foreach ($this->widgets as $widget) {
                if ($filename === qtype_recordrtc::get_media_filename($widget->name, $this->mediatype)) {
                    return true;
                }
            }
        }
        return parent::check_file_access($qa, $options, $component, $filearea, $args, $forcedownload);
    }

    /**
     * Get the file uploaded in the response for a particular widget, if any.
     *
     * @param array $response The submitted response.
     * @param string $widgetname The name of the widget.
     * @return stored_file|null The file, if one was uploaded.
     */
    public function get_file_from_response(array $response, string $widgetname): ?stored_file {
        if (empty($response[$widgetname])) {
            return null;
        }
        $filename = qtype_recordrtc::get_media_filename($widgetname, $this->mediatype);
        $fs = get_file_storage();
        $files = $fs->get_area_files(
            $this->context->id,
            'question',
            'response_recording',
            $this->id,
            'filename',
            false
        );
        foreach ($files as $file) {
            if ($file->get_filename() === $filename) {
                return $file;
            }
        }
        return null;
    }

    /**
     * Get the maximum upload size allowed for recordings in this question.
     *
     * @return int The maximum size in bytes.
     */
    public function get_upload_size_limit(): int {
        return min(
            (int) get_config('qtype_recordrtc', 'maxuploadsize'),
            (int) $CFG->maxbytes
        );
    }

    public function apply_attempt_state(question_attempt_step $step) {
        foreach ($this->widgets as $widget) {
            $attemptstate = $step->get_qt_var('_' . $widget->name);
            if ($attemptstate === null) {
                $step->set_qt_var('_' . $widget->name, 0);
            }
        }
    }
}