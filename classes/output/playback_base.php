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

use qtype_recordrtc;
use renderable;
use renderer_base;
use templatable;

/**
 * Base class which holds the information which applies to both audio an video widgets.
 *
 * @package   qtype_recordrtc
 * @copyright 2022 The Open University
 * @license   http://www.gnu.org/copyleft/gpl.html GNU GPL v3 or later
 */
abstract class playback_base implements renderable, templatable {

    /**
     * @var string the file name.
     */
    protected $filename;

    /**
     * @var string if we are re-displaying, after a recording was made, this is the audio file.
     */
    protected $recordingurl;

    /**
     * @var bool whether the current user should see options to download the recordings.
     */
    protected $candownload;

    protected $enablereflection;
    protected $reflectiontime;
    /**
     * Constructor.
     *
     * @param string $filename the file name.
     * @param moodle_url|null $recordingurl the recording URL.
     * @param bool $candownload whether downloading is allowed.
     * @param bool $enablereflection whether reflection is enabled.
     * @param int $reflectiontime reflection time in seconds.
     */
    public function __construct(string $filename, ?moodle_url $recordingurl, bool $candownload, bool $enablereflection = false, int $reflectiontime = 10) {
        $this->filename = $filename;
        $this->recordingurl = $recordingurl;
        $this->candownload = $candownload;
        $this->enablereflection = $enablereflection;
        $this->reflectiontime = $reflectiontime;
    }

    public function export_for_template(renderer_base $output): array {
        $data = parent::export_for_template($output);
        $data['enablereflection'] = $this->enablereflection;
        $data['reflectiontime'] = $this->reflectiontime;
        return $data;
    }
}
