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

namespace qtype_recordrtc\output;

/**
 * Represents an audio widget, for output.
 *
 * @package   qtype_recordrtc
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
class audio_recorder extends recorder_base {
    public function export_for_template(renderer_base $output): array {
        $data = parent::export_for_template($output);
        // Assuming $this->enablereflection and $this->reflectiontime are set
        $data['enablereflection'] = $this->enablereflection;
        $data['reflectiontime'] = $this->reflectiontime;
        return $data;
    }
}
