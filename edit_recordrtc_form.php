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
 * Defines the form for editing recordrtc questions.
 *
 * @package   qtype_recordrtc
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */

defined('MOODLE_INTERNAL') || die();

require_once($CFG->dirroot . '/question/type/questiontypebase.php');
require_once($CFG->dirroot . '/question/engine/bank.php');
require_once($CFG->dirroot . '/question/type/edit_question_form.php');

/**
 * RecordRTC question type editing form definition.
 *
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class qtype_recordrtc_edit_form extends question_edit_form {

    protected function definition_inner($mform) {
        $this->add_per_answer_fields($mform, get_string('feedbackforwidget', 'qtype_recordrtc', '{no}'),
                question_bank::fraction_options(), 1, 1);

        $mform->addElement('select', 'mediatype',
                get_string('mediatype', 'qtype_recordrtc'),
                [
                    'audio' => get_string('audio', 'qtype_recordrtc'),
                    'video' => get_string('video', 'qtype_recordrtc'),
                    'screen' => get_string('screen', 'qtype_recordrtc'),
                    'customav' => get_string('customav', 'qtype_recordrtc'),
                ]);

        $this->add_timelimit_field($mform);
        $this->add_allowpausing_field($mform);
        $this->add_selfassessment_fields($mform);
        $this->add_reflection_fields($mform);
    }

    /**
     * Add a field to set the time limit for recordings.
     *
     * @param MoodleQuickForm $mform the form being built.
     */
    protected function add_timelimit_field($mform) {
        $mform->addElement('text', 'timelimitinseconds',
                get_string('timelimit', 'qtype_recordrtc'),
                ['size' => 5]);
        $mform->setType('timelimitinseconds', PARAM_INT);
        $mform->addRule('timelimitinseconds', null, 'required', null, 'client');
        $mform->addRule('timelimitinseconds', get_string('errorintimelimit', 'qtype_recordrtc'), 'numeric', null, 'client');
        $mform->setDefault('timelimitinseconds', 30);
        $mform->addHelpButton('timelimitinseconds', 'timelimit', 'qtype_recordrtc');
    }

    /**
     * Add a field to control whether pausing is allowed.
     *
     * @param MoodleQuickForm $mform the form being built.
     */
    protected function add_allowpausing_field($mform) {
        $mform->addElement('advcheckbox', 'allowpausing',
                get_string('allowpausing', 'qtype_recordrtc'), null, null, [0, 1]);
        $mform->setDefault('allowpausing', 0);
        $mform->addHelpButton('allowpausing', 'allowpausing', 'qtype_recordrtc');
    }

    /**
     * Add fields to control self-assessment capabilities.
     *
     * @param MoodleQuickForm $mform the form being built.
     */
    protected function add_selfassessment_fields($mform) {
        $mform->addElement('advcheckbox', 'canselfrate',
                get_string('canselfrate', 'qtype_recordrtc'), null, null, [0, 1]);
        $mform->setDefault('canselfrate', 0);
        $mform->addHelpButton('canselfrate', 'canselfrate', 'qtype_recordrtc');

        $mform->addElement('advcheckbox', 'canselfcomment',
                get_string('canselfcomment', 'qtype_recordrtc'), null, null, [0, 1]);
        $mform->setDefault('canselfcomment', 0);
        $mform->addHelpButton('canselfcomment', 'canselfcomment', 'qtype_recordrtc');
    }

    /**
     * Add fields to control reflection and preview capabilities.
     *
     * @param MoodleQuickForm $mform the form being built.
     */
    protected function add_reflection_fields($mform) {
        $mform->addElement('advcheckbox', 'enablereflection',
                get_string('enablereflection', 'qtype_recordrtc'), null, null, [0, 1]);
        $mform->setDefault('enablereflection', 0);
        $mform->addHelpButton('enablereflection', 'enablereflection', 'qtype_recordrtc');

        $mform->addElement('text', 'reflectiontime',
                get_string('reflectionandpreviewtime', 'qtype_recordrtc'),
                ['size' => 5]);
        $mform->setType('reflectiontime', PARAM_INT);
        $mform->setDefault('reflectiontime', 10);
        $mform->addHelpButton('reflectiontime', 'reflectionandpreviewtime', 'qtype_recordrtc');
        $mform->disabledIf('reflectiontime', 'enablereflection', 'notchecked');
    }

    protected function data_preprocessing($question) {
        $question = parent::data_preprocessing($question);

        if (empty($question->options)) {
            return $question;
        }

        $question->mediatype = $question->options->mediatype;
        $question->timelimitinseconds = $question->options->timelimitinseconds;
        $question->allowpausing = $question->options->allowpausing;
        $question->canselfrate = $question->options->canselfrate;
        $question->canselfcomment = $question->options->canselfcomment;
        $question->enablereflection = $question->options->enablereflection;
        $question->reflectiontime = $question->options->reflectiontime;

        return $question;
    }

    public function validation($data, $files) {
        $errors = parent::validation($data, $files);

        if ($data['mediatype'] === 'customav') {
            $widgetcount = substr_count($data['questiontext']['text'], ':audio') +
                    substr_count($data['questiontext']['text'], ':video') +
                    substr_count($data['questiontext']['text'], ':screen');
            if ($widgetcount < 2) {
                $errors['questiontext'] = get_string('notenoughwidgetplaceholders', 'qtype_recordrtc');
            }
        }

        $maxtimelimit = (int) get_config('qtype_recordrtc', $data['mediatype'] . 'timelimit');
        if ($data['timelimitinseconds'] > $maxtimelimit) {
            $errors['timelimitinseconds'] = get_string('timelimittoohigh', 'qtype_recordrtc', $maxtimelimit);
        } else if ($data['timelimitinseconds'] <= 0) {
            $errors['timelimitinseconds'] = get_string('errorintimelimit', 'qtype_recordrtc');
        }

        if ($data['reflectiontime'] <= 0) {
            $errors['reflectiontime'] = get_string('errorinreflectiontime', 'qtype_recordrtc');
        }

        return $errors;
    }

    public function qtype() {
        return 'recordrtc';
    }
}