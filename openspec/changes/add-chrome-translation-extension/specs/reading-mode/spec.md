## ADDED Requirements
### Requirement: Reading Mode Segmentation
The system SHALL provide a reading mode that segments original-language content into shorter readable chunks.

#### Scenario: Segment long text for reading
- **WHEN** reading mode is enabled on a page
- **THEN** long source text is segmented into smaller chunks
- **AND** chunks are joined/shown with delimiter `  |  `
- **AND** segmentation applies lightweight NLP-oriented rules including sentence-boundary detection, abbreviation/decimal protection, long-sentence secondary split, and short-fragment merge

### Requirement: Difficult Phrase Pre-Translation
The system SHALL pre-translate difficult or low-frequency phrases and display them below source content in reading mode.

#### Scenario: Display glossary-like pre-translation
- **WHEN** reading mode processes a paragraph
- **THEN** difficult phrase candidates are extracted and translated
- **AND** translated hints are rendered below corresponding source paragraph

### Requirement: Reading Mode Render Order and Deduplication
The system SHALL render reading-mode artifacts in stable order and skip immediate duplicate content.

#### Scenario: Render reading artifacts in fixed order
- **WHEN** reading mode finishes processing one source paragraph
- **THEN** it renders segmented text first
- **AND** then renders difficult/low-frequency phrase translations
- **AND** then renders full-paragraph translation

#### Scenario: Skip duplicate adjacent rendered content
- **WHEN** the next reading-mode artifact text is identical to the previous inserted artifact text of the same artifact type after normalization
- **THEN** the system does not render the duplicate artifact

#### Scenario: Remove duplicate glossary rows inside one paragraph
- **WHEN** reading mode generates glossary rows for one paragraph
- **THEN** repeated identical glossary row text is rendered only once

### Requirement: Reading Mode Visual Differentiation
The system SHALL visually differentiate segmented source content and full-paragraph translation in reading mode.

#### Scenario: Segmentation and translation boxes use different backgrounds
- **WHEN** reading mode renders segmented text and paragraph translation
- **THEN** segmented text box and translation text box use different background colors

### Requirement: Hover and Selection Inline Translation
The system SHALL auto-show translation under content when user hovers or selects text in reading mode.

#### Scenario: Hover trigger translation
- **WHEN** user hovers over a phrase for at least 0.3 seconds
- **THEN** the system translates the hovered phrase
- **AND** renders translation below the phrase context

#### Scenario: Selection trigger translation
- **WHEN** user selects a word or sentence
- **THEN** the system translates selected content
- **AND** renders translation below selected content context
