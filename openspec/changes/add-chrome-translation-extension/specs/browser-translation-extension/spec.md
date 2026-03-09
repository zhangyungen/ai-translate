## ADDED Requirements
### Requirement: Universal Translation in Chrome Extension
The system SHALL provide a Chrome Manifest V3 extension that translates from any supported source language to any supported target language, with English-to-Chinese as the default optimized experience.

#### Scenario: User translates text in popup
- **WHEN** the user enters source text and chooses source/target languages in popup
- **THEN** the extension returns translated text through the unified translation gateway
- **AND** the default target language is Chinese when no user preference exists

### Requirement: Tencent-Style Popup and Page Translation Interaction
The system SHALL provide popup interaction and page translation interaction consistent with the Tencent plugin style, including language selectors, swap action, and page translation toggle.

#### Scenario: User toggles page translation
- **WHEN** the user clicks page-translation toggle in popup or context menu
- **THEN** the current page content is translated in place
- **AND** the user can toggle again to restore original content

### Requirement: Translation Mode Mutual Exclusivity
The system SHALL ensure reading mode and page translation mode are mutually exclusive at runtime.

#### Scenario: Switch from page translation to reading mode
- **WHEN** page translation is enabled and user enables reading mode
- **THEN** the system disables page translation and restores original page text first
- **AND** then re-runs translation pipeline for reading mode

#### Scenario: Switch from reading mode to page translation
- **WHEN** reading mode is enabled and user enables page translation
- **THEN** the system clears reading mode artifacts first
- **AND** then re-runs translation pipeline for page translation

### Requirement: Viewport Incremental Page Translation
The system SHALL translate page content incrementally by viewport, so that content currently visible to the user is prioritized and additional content is translated during scrolling.

#### Scenario: Translate as user scrolls
- **WHEN** page translation is enabled and user scrolls to new page regions
- **THEN** newly visible source text is translated in place
- **AND** off-screen untranslated content is deferred until it becomes visible

### Requirement: Page-Mode Duplicate Display Suppression
The system SHALL suppress duplicate render output in page translation mode.

#### Scenario: Skip duplicate candidates from dynamic DOM
- **WHEN** page mode rescans content after scroll/resize/mutation
- **THEN** the system skips candidates that match existing processed position+text keys
- **AND** does not re-render equivalent translation blocks for those candidates

#### Scenario: Skip consecutive identical translated blocks
- **WHEN** current translated block text is identical to the previously inserted page translation block text after whitespace normalization
- **THEN** the system does not render the duplicated page translation block

### Requirement: Tencent API Mechanism Compatibility
The system SHALL use a Tencent-compatible translation gateway with a unified endpoint and a compatible client-key strategy.

#### Scenario: Gateway builds request with compatible key
- **WHEN** any translation use case sends a request
- **THEN** the gateway posts to `https://transmart.qq.com/api/imt`
- **AND** request header includes `client_key` computed as `("tencent_transmart_crx_" + btoa(navigator.userAgent)).slice(0,100)`

### Requirement: Language Capability Cache and Renewal
The system SHALL cache supported language pairs locally and auto-refresh cache on expiry.

#### Scenario: Language cache expires
- **WHEN** cached language list is older than 24 hours
- **THEN** the extension fetches fresh language capability data
- **AND** updates local cache timestamp and payload

### Requirement: Translation Result Cache Reuse
The system SHALL cache translated text results and reuse them in subsequent page/popup translation flows when request dimensions match.

#### Scenario: Cache hit for repeated translation
- **WHEN** source text and language pair match an existing cache entry
- **THEN** the system returns cached translation before issuing new remote request
- **AND** cache entry can be reused by scroll-triggered incremental translation

### Requirement: Page-Level Automatic Language Pair Selection
The system SHALL derive source and target languages automatically per page for page/reading translation flows.

#### Scenario: Auto-select target language by source language class
- **WHEN** page source language is identified as Chinese
- **THEN** target language is English
- **AND** when page source language is identified as English, target language is Chinese
- **AND** when page source language is neither Chinese nor English, target language follows browser preferred language

#### Scenario: Skip translation when source equals target
- **WHEN** derived source language and target language are the same
- **THEN** the system skips translation execution
- **AND** informs user that translation is not needed

### Requirement: Translation Gateway Response Robustness
The system SHALL tolerate multiple translation response shapes from upstream gateway without crashing translation flows.

#### Scenario: Non-string translation payload
- **WHEN** translation gateway returns array/object forms instead of a direct translation string
- **THEN** the system extracts normalized translated text from supported fallback fields
- **AND** returns null with warning log only when no usable text can be extracted

### Requirement: Popup Mode Status Visibility
The system SHALL show current enabled function mode in popup for active tab.

#### Scenario: Popup opens on translated page
- **WHEN** user opens popup on a tab with active mode
- **THEN** popup shows one of: no active mode, page translation active, or reading mode active
- **AND** mode label refreshes after user toggles feature switches

### Requirement: Domain-Driven Modular Architecture and Code Quality
The system SHALL enforce high cohesion/low coupling with domain-driven module boundaries and centralized constants/enums.

#### Scenario: Non-happy path execution
- **WHEN** any workflow cannot proceed by normal business flow
- **THEN** the system logs a `warn` event with actionable context
- **AND** avoids hidden silent failures

### Requirement: One-Command Packaging
The system SHALL provide a one-command packaging workflow for extension distribution.

#### Scenario: Build package command execution
- **WHEN** developer runs the documented packaging command
- **THEN** the project produces a loadable/distributable extension artifact
