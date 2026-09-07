import 'package:flutter_gen/gen_l10n/app_localizations.dart';
import 'package:geolocator/geolocator.dart';

enum LocationErrorKind { servicesDisabled, permissionDenied, permissionDeniedForever }

class LocationException implements Exception {
  final LocationErrorKind kind;
  final String debugDetail;
  LocationException(this.kind, this.debugDetail);

  /// Technical, English-only detail — for logs/debugging, not the UI.
  @override
  String toString() => debugDetail;

  /// User-facing, translated message. Exceptions are thrown from this
  /// service class with no `BuildContext` to localize with directly, so
  /// callers (which do have one) resolve the actual string via this
  /// method instead of showing [toString]'s raw English detail.
  String localizedMessage(AppLocalizations l10n) {
    switch (kind) {
      case LocationErrorKind.servicesDisabled:
        return l10n.locationErrorServicesDisabled;
      case LocationErrorKind.permissionDenied:
        return l10n.locationErrorPermissionDenied;
      case LocationErrorKind.permissionDeniedForever:
        return l10n.locationErrorPermissionDeniedForever;
    }
  }
}

/// Thin wrapper over `geolocator` for "Use my current location" (onboarding
/// and hazard reports). Every failure mode (services off, permission
/// denied/denied forever) surfaces as a real `LocationException` with a
/// message a user can act on — never a silent fallback to a fake position.
class LocationService {
  Future<Position> getCurrentPosition() async {
    if (!await Geolocator.isLocationServiceEnabled()) {
      throw LocationException(
        LocationErrorKind.servicesDisabled,
        'Location services are turned off. Enable location in your device settings and try again.',
      );
    }

    LocationPermission permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.denied) {
        throw LocationException(LocationErrorKind.permissionDenied, 'Location permission was denied.');
      }
    }
    if (permission == LocationPermission.deniedForever) {
      throw LocationException(
        LocationErrorKind.permissionDeniedForever,
        'Location permission is permanently denied. Enable it for AfriShield in your device settings.',
      );
    }

    return Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(accuracy: LocationAccuracy.high),
    );
  }
}
