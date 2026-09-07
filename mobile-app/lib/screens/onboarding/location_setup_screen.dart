import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:provider/provider.dart';

import '../../data/countries.dart';
import '../../data/geo_data.dart';
import '../../providers/onboarding_provider.dart';
import '../../services/location_service.dart';
import '../../theme/app_theme.dart';
import '../root_shell.dart';
import 'geo_picker_screen.dart';

/// State/Region and City/Community are real pickers, sourced from
/// `assets/geo/states_cities.json` (see `lib/data/geo_data.dart` for
/// provenance) — 1,117 real states/regions and 4,638 real cities/towns
/// across all 54 countries. Local Government Area stays a plain text
/// field: no equally reliable third administrative tier exists across all
/// 54 countries in the open dataset used here (Nigeria's own LGA
/// terminology doesn't generalize), so faking one would be worse than a
/// text field.
class LocationSetupScreen extends StatefulWidget {
  final Country country;
  final bool fromSettings;

  const LocationSetupScreen({super.key, required this.country, this.fromSettings = false});

  @override
  State<LocationSetupScreen> createState() => _LocationSetupScreenState();
}

class _LocationSetupScreenState extends State<LocationSetupScreen> {
  late final _stateController = TextEditingController(
      text: context.read<OnboardingProvider>().stateRegion ?? '');
  late final _lgaController =
      TextEditingController(text: context.read<OnboardingProvider>().lga ?? '');
  late final _cityController =
      TextEditingController(text: context.read<OnboardingProvider>().city ?? '');
  bool _rememberLocation = false;
  final _locationService = LocationService();
  bool _locatingGps = false;
  double? _gpsLatitude;
  double? _gpsLongitude;

  List<GeoState>? _statesForCountry;

  @override
  void initState() {
    super.initState();
    loadGeoData().then((data) {
      if (!mounted) return;
      setState(() => _statesForCountry = data[widget.country.iso3] ?? []);
    });
  }

  @override
  void dispose() {
    _stateController.dispose();
    _lgaController.dispose();
    _cityController.dispose();
    super.dispose();
  }

  GeoState? get _selectedState {
    final states = _statesForCountry;
    if (states == null || _stateController.text.isEmpty) return null;
    for (final s in states) {
      if (s.name == _stateController.text) return s;
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context)!;
    // Null while still loading; empty list is a genuine "no data for this
    // country yet" case (shouldn't happen for the current 54, but this
    // keeps the field usable as free text if it ever does).
    final hasStateData = (_statesForCountry ?? const []).isNotEmpty;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.locationAppBarTitle)),
      body: Padding(
        padding: const EdgeInsets.all(16),
        child: ListView(
          children: [
            Text(l10n.whereAreYouLocated,
                style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 20)),
            const SizedBox(height: 4),
            Text(l10n.locationIntro,
                style: const TextStyle(color: AppColors.inkSoft)),
            const SizedBox(height: 20),
            _FieldLabel(l10n.countryFieldLabel),
            TextField(
              readOnly: true,
              controller: TextEditingController(text: widget.country.name),
            ),
            const SizedBox(height: 16),
            _FieldLabel(l10n.stateFieldLabel),
            TextField(
              controller: _stateController,
              readOnly: hasStateData,
              decoration: InputDecoration(
                hintText: l10n.stateFieldHint,
                suffixIcon: hasStateData ? const Icon(Icons.arrow_drop_down) : null,
              ),
              onTap: hasStateData ? _pickState : null,
            ),
            const SizedBox(height: 16),
            _FieldLabel(l10n.lgaFieldLabel),
            TextField(
              controller: _lgaController,
              decoration: InputDecoration(hintText: l10n.lgaFieldHint),
            ),
            const SizedBox(height: 16),
            _FieldLabel(l10n.cityFieldLabel),
            Builder(builder: (context) {
              final canPickCity = _selectedState != null && _selectedState!.cities.isNotEmpty;
              return TextField(
                controller: _cityController,
                readOnly: canPickCity,
                decoration: InputDecoration(
                  hintText: l10n.cityFieldHint,
                  suffixIcon: canPickCity ? const Icon(Icons.arrow_drop_down) : null,
                ),
                // Only intercepts the tap to open a picker when there's
                // real city data for the selected state — otherwise this
                // is a normal free-text field (no state picked yet, or
                // this state has no city data), so tapping just places
                // the text cursor as usual.
                onTap: canPickCity ? () => _pickCity(l10n) : null,
              );
            }),
            const SizedBox(height: 20),
            Row(
              children: [
                const Expanded(child: Divider()),
                Padding(
                  padding: const EdgeInsets.symmetric(horizontal: 12),
                  child: Text(l10n.orDivider, style: const TextStyle(fontWeight: FontWeight.w700)),
                ),
                const Expanded(child: Divider()),
              ],
            ),
            const SizedBox(height: 16),
            OutlinedButton.icon(
              onPressed: _locatingGps ? null : _useCurrentLocation,
              icon: _locatingGps
                  ? const SizedBox(
                      height: 16,
                      width: 16,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Icon(Icons.my_location),
              label: Text(l10n.useMyCurrentLocation),
            ),
            if (_gpsLatitude != null && _gpsLongitude != null) ...[
              const SizedBox(height: 8),
              Text(
                l10n.gpsCapturedNote(
                  _gpsLatitude!.toStringAsFixed(4),
                  _gpsLongitude!.toStringAsFixed(4),
                ),
                style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
              ),
            ],
            const SizedBox(height: 8),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: _rememberLocation,
              onChanged: (v) => setState(() => _rememberLocation = v ?? false),
              title: Text(l10n.rememberLocation),
            ),
            Text(
              l10n.locationUsageNote,
              style: const TextStyle(color: AppColors.inkSoft, fontSize: 12),
            ),
            const SizedBox(height: 24),
            FilledButton(
              onPressed: _continue,
              child: Text(l10n.continueButton),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _pickState() async {
    final states = _statesForCountry;
    if (states == null || states.isEmpty) return;
    final l10n = AppLocalizations.of(context)!;
    final picked = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => GeoPickerScreen(
          title: l10n.stateFieldLabel,
          searchHint: l10n.stateFieldHint,
          items: states.map((s) => s.name).toList(),
        ),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _stateController.text = picked;
      // A new state's city list is different (or empty) — a previously
      // picked city almost certainly doesn't belong to it.
      _cityController.clear();
    });
  }

  Future<void> _pickCity(AppLocalizations l10n) async {
    // Only ever called when a state with real city data is selected (see
    // the `canPickCity` guard on this field's `onTap`) — otherwise the
    // City field is plain free text and this never fires.
    final state = _selectedState!;
    final picked = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => GeoPickerScreen(
          title: l10n.cityFieldLabel,
          searchHint: l10n.cityFieldHint,
          items: state.cities,
        ),
      ),
    );
    if (picked == null || !mounted) return;
    setState(() => _cityController.text = picked);
  }

  Future<void> _useCurrentLocation() async {
    setState(() => _locatingGps = true);
    try {
      final position = await _locationService.getCurrentPosition();
      if (!mounted) return;
      setState(() {
        _gpsLatitude = position.latitude;
        _gpsLongitude = position.longitude;
        _locatingGps = false;
      });
    } on LocationException catch (e) {
      if (!mounted) return;
      setState(() => _locatingGps = false);
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(e.localizedMessage(AppLocalizations.of(context)!))));
    }
  }

  void _continue() async {
    await context.read<OnboardingProvider>().completeLocation(
          country: widget.country.iso3,
          stateRegion: _stateController.text.trim().isEmpty ? null : _stateController.text.trim(),
          lga: _lgaController.text.trim().isEmpty ? null : _lgaController.text.trim(),
          city: _cityController.text.trim().isEmpty ? null : _cityController.text.trim(),
          latitude: _gpsLatitude,
          longitude: _gpsLongitude,
        );
    if (!mounted) return;
    if (widget.fromSettings) {
      Navigator.of(context)
        ..pop()
        ..pop();
      return;
    }
    Navigator.of(context).pushAndRemoveUntil(
      MaterialPageRoute(builder: (_) => const RootShell()),
      (route) => false,
    );
  }
}

class _FieldLabel extends StatelessWidget {
  final String text;
  const _FieldLabel(this.text);

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6),
      child: Text(text, style: const TextStyle(fontWeight: FontWeight.w700)),
    );
  }
}
