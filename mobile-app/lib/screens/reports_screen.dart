import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:image_picker/image_picker.dart';
import 'package:provider/provider.dart';

import '../models/hazard_report.dart';
import '../providers/onboarding_provider.dart';
import '../services/api_service.dart';
import '../services/location_service.dart';
import '../theme/app_theme.dart';

/// Community hazard reporting — matches the Figma "Report a Hazard" screen.
/// Submits for real to `POST /api/hazard-reports` via `ApiService`, with a
/// real photo attachment (`POST /api/hazard-reports/{id}/photo`) and a real
/// GPS fix (`geolocator`) — see `docs/api-contract.md`.
class ReportsScreen extends StatefulWidget {
  const ReportsScreen({super.key});

  @override
  State<ReportsScreen> createState() => _ReportsScreenState();
}

class _ReportsScreenState extends State<ReportsScreen> {
  final _api = ApiService();
  final _imagePicker = ImagePicker();
  final _locationService = LocationService();

  String? _category;
  bool _submitting = false;
  final _descriptionController = TextEditingController();

  Uint8List? _photoBytes;
  String? _photoName;
  String? _photoContentType;

  bool _locatingGps = false;
  double? _gpsLatitude;
  double? _gpsLongitude;

  @override
  void dispose() {
    _descriptionController.dispose();
    super.dispose();
  }

  /// The English `category` values in `hazardCategories` are also the
  /// literal data sent to `POST /api/hazard-reports` and the keys
  /// `_CategoryTile` uses to look up an icon — only the on-screen label is
  /// translated, so submitting still sends the same value regardless of
  /// the selected language.
  String _categoryLabel(AppLocalizations l10n, String category) {
    switch (category) {
      case 'Water Rising':
        return l10n.categoryWaterRising;
      case 'Heavy Rainfall':
        return l10n.categoryHeavyRainfall;
      case 'Flooded Road':
        return l10n.categoryFloodedRoad;
      case 'Flooded Home':
        return l10n.categoryFloodedHome;
      default:
        return l10n.categoryOther;
    }
  }

  @override
  Widget build(BuildContext context) {
    final onboarding = context.watch<OnboardingProvider>();
    final l10n = AppLocalizations.of(context)!;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.reportAHazardTitle)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 16, 16, 16 + kBottomNavClearance),
        children: [
          Text(l10n.whatAreYouSeeing, style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 18)),
          Text(l10n.reportsSubtitle,
              style: const TextStyle(color: AppColors.inkSoft)),
          const SizedBox(height: 16),
          ...hazardCategories.map(
            (c) => Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: _CategoryTile(
                value: c,
                label: _categoryLabel(l10n, c),
                selected: _category == c,
                onTap: () => setState(() => _category = c),
              ),
            ),
          ),
          const SizedBox(height: 8),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(l10n.yourLocationLabel, style: const TextStyle(fontWeight: FontWeight.w700)),
              Text(onboarding.displayLocation, style: const TextStyle(color: AppColors.inkSoft)),
            ],
          ),
          Align(
            alignment: Alignment.centerLeft,
            child: TextButton.icon(
              onPressed: _locatingGps ? null : _useCurrentLocation,
              icon: _locatingGps
                  ? const SizedBox(
                      height: 14,
                      width: 14,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : Icon(_gpsLatitude != null ? Icons.check_circle : Icons.my_location, size: 18),
              label: Text(
                _gpsLatitude != null
                    ? l10n.gpsAttachedLabel(_gpsLatitude!.toStringAsFixed(4), _gpsLongitude!.toStringAsFixed(4))
                    : l10n.attachGpsLocation,
              ),
            ),
          ),
          const SizedBox(height: 4),
          TextField(
            controller: _descriptionController,
            maxLines: 4,
            decoration: InputDecoration(hintText: l10n.describeWhatYoureSeeingHint),
          ),
          const SizedBox(height: 12),
          if (_photoBytes == null)
            Align(
              alignment: Alignment.centerRight,
              child: OutlinedButton.icon(
                onPressed: _pickPhoto,
                icon: const Icon(Icons.camera_alt_outlined),
                label: Text(l10n.addPhoto),
              ),
            )
          else
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                border: Border.all(color: AppColors.divider),
                borderRadius: BorderRadius.circular(12),
              ),
              child: Row(
                children: [
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.memory(_photoBytes!, width: 48, height: 48, fit: BoxFit.cover),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(_photoName ?? l10n.photoAttachedFallback, overflow: TextOverflow.ellipsis),
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => setState(() {
                      _photoBytes = null;
                      _photoName = null;
                      _photoContentType = null;
                    }),
                  ),
                ],
              ),
            ),
          const SizedBox(height: 20),
          FilledButton(
            onPressed: (_category == null || _submitting) ? null : _submit,
            child: _submitting
                ? const SizedBox(
                    height: 18,
                    width: 18,
                    child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                  )
                : Text(l10n.submitReport),
          ),
        ],
      ),
    );
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

  Future<void> _pickPhoto() async {
    final l10n = AppLocalizations.of(context)!;
    final source = await showModalBottomSheet<ImageSource>(
      context: context,
      builder: (_) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            ListTile(
              leading: const Icon(Icons.photo_camera_outlined),
              title: Text(l10n.takePhoto),
              onTap: () => Navigator.pop(context, ImageSource.camera),
            ),
            ListTile(
              leading: const Icon(Icons.photo_library_outlined),
              title: Text(l10n.chooseFromGallery),
              onTap: () => Navigator.pop(context, ImageSource.gallery),
            ),
          ],
        ),
      ),
    );
    if (source == null || !mounted) return;

    try {
      final picked = await _imagePicker.pickImage(source: source, maxWidth: 1600, imageQuality: 85);
      if (picked == null) return;
      final bytes = await picked.readAsBytes();
      if (!mounted) return;
      setState(() {
        _photoBytes = bytes;
        _photoName = picked.name;
        _photoContentType = picked.mimeType ?? _guessContentType(picked.name);
      });
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context)
          .showSnackBar(SnackBar(content: Text(l10n.couldNotAccessCamera(e.toString()))));
    }
  }

  String _guessContentType(String filename) {
    final lower = filename.toLowerCase();
    if (lower.endsWith('.png')) return 'image/png';
    if (lower.endsWith('.webp')) return 'image/webp';
    return 'image/jpeg';
  }

  Future<void> _submit() async {
    final l10n = AppLocalizations.of(context)!;
    final report = HazardReport(
      category: _category!,
      description: _descriptionController.text.trim().isEmpty ? null : _descriptionController.text.trim(),
      locationName: context.read<OnboardingProvider>().displayLocation,
      submittedAt: DateTime.now(),
      latitude: _gpsLatitude,
      longitude: _gpsLongitude,
    );

    setState(() => _submitting = true);

    final String reportId;
    try {
      reportId = await _api.submitHazardReport(report);
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() => _submitting = false);
      _showResultDialog(
        title: l10n.couldNotSendReportTitle,
        message: l10n.couldNotSendReportBody(e.localizedMessage(l10n)),
      );
      return;
    }

    String? photoError;
    if (_photoBytes != null) {
      try {
        await _api.uploadHazardReportPhoto(
          reportId,
          _photoBytes!,
          _photoName ?? 'photo.jpg',
          _photoContentType ?? 'image/jpeg',
        );
      } on ApiException catch (e) {
        photoError = e.localizedMessage(l10n);
      }
    }

    if (!mounted) return;
    setState(() => _submitting = false);
    _showResultDialog(
      title: photoError == null ? l10n.reportSentTitle : l10n.reportSentPhotoFailedTitle,
      message: photoError == null
          ? l10n.reportSentBody(_categoryLabel(l10n, report.category), report.locationName)
          : l10n.reportSentPhotoFailedBody(_categoryLabel(l10n, report.category), report.locationName, photoError),
      onOk: () => setState(() {
        _category = null;
        _descriptionController.clear();
        _photoBytes = null;
        _photoName = null;
        _photoContentType = null;
        _gpsLatitude = null;
        _gpsLongitude = null;
      }),
    );
  }

  void _showResultDialog({required String title, required String message, VoidCallback? onOk}) {
    showDialog(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: Text(title),
        content: Text(message),
        actions: [
          TextButton(
            onPressed: () {
              Navigator.pop(dialogContext);
              onOk?.call();
            },
            child: Text(AppLocalizations.of(dialogContext)!.ok),
          ),
        ],
      ),
    );
  }
}

class _CategoryTile extends StatelessWidget {
  final String value;
  final String label;
  final bool selected;
  final VoidCallback onTap;

  const _CategoryTile({required this.value, required this.label, required this.selected, required this.onTap});

  static const _icons = {
    'Water Rising': Icons.waves,
    'Heavy Rainfall': Icons.grain,
    'Flooded Road': Icons.warning_amber,
    'Flooded Home': Icons.house_outlined,
    'Other': Icons.report_gmailerrorred_outlined,
  };

  @override
  Widget build(BuildContext context) {
    return Material(
      color: selected ? AppColors.navy.withValues(alpha: 0.08) : AppColors.surface,
      borderRadius: BorderRadius.circular(14),
      child: InkWell(
        borderRadius: BorderRadius.circular(14),
        onTap: onTap,
        child: Container(
          padding: const EdgeInsets.all(14),
          decoration: BoxDecoration(
            border: Border.all(color: selected ? AppColors.navy : AppColors.divider),
            borderRadius: BorderRadius.circular(14),
          ),
          child: Row(
            children: [
              Icon(_icons[value] ?? Icons.help_outline, color: AppColors.navy),
              const SizedBox(width: 12),
              Text(label, style: const TextStyle(fontWeight: FontWeight.w700)),
              const Spacer(),
              if (selected) const Icon(Icons.check_circle, color: AppColors.navy, size: 18),
            ],
          ),
        ),
      ),
    );
  }
}
