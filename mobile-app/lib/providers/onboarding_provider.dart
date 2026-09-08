import 'package:flutter/foundation.dart';
import 'package:shared_preferences/shared_preferences.dart';

/// Everything captured during the Splash -> Welcome -> Language ->
/// Country -> Location flow, plus whether that flow has been completed at
/// all (so a returning user skips straight to the main app).
class OnboardingProvider extends ChangeNotifier {
  static const _completeKey = 'onboarding_complete_v1';
  static const _languageKey = 'onboarding_language_v1';
  static const _countryKey = 'onboarding_country_v1';
  static const _stateRegionKey = 'onboarding_state_region_v1';
  static const _lgaKey = 'onboarding_lga_v1';
  static const _cityKey = 'onboarding_city_v1';
  static const _latitudeKey = 'onboarding_latitude_v1';
  static const _longitudeKey = 'onboarding_longitude_v1';
  static const _phoneNumberKey = 'onboarding_phone_number_v1';

  bool isComplete = false;
  String language = 'English';
  String? country;
  String? stateRegion;
  String? lga;
  String? city;
  double? latitude;
  double? longitude;
  String? phoneNumber;

  Future<void> load() async {
    final prefs = await SharedPreferences.getInstance();
    isComplete = prefs.getBool(_completeKey) ?? false;
    language = prefs.getString(_languageKey) ?? 'English';
    country = prefs.getString(_countryKey);
    stateRegion = prefs.getString(_stateRegionKey);
    lga = prefs.getString(_lgaKey);
    city = prefs.getString(_cityKey);
    latitude = prefs.getDouble(_latitudeKey);
    longitude = prefs.getDouble(_longitudeKey);
    phoneNumber = prefs.getString(_phoneNumberKey);
    notifyListeners();
  }

  Future<void> setLanguage(String value) async {
    language = value;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_languageKey, value);
    notifyListeners();
  }

  Future<void> completeLocation({
    required String country,
    String? stateRegion,
    String? lga,
    String? city,
    double? latitude,
    double? longitude,
    String? phoneNumber,
  }) async {
    this.country = country;
    this.stateRegion = stateRegion;
    this.lga = lga;
    this.city = city;
    this.latitude = latitude;
    this.longitude = longitude;
    this.phoneNumber = phoneNumber;
    isComplete = true;
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_countryKey, country);
    if (stateRegion != null) await prefs.setString(_stateRegionKey, stateRegion);
    if (lga != null) await prefs.setString(_lgaKey, lga);
    if (city != null) await prefs.setString(_cityKey, city);
    if (latitude != null) await prefs.setDouble(_latitudeKey, latitude);
    if (longitude != null) await prefs.setDouble(_longitudeKey, longitude);
    if (phoneNumber != null) await prefs.setString(_phoneNumberKey, phoneNumber);
    await prefs.setBool(_completeKey, true);
    notifyListeners();
  }

  /// Free-text display of whatever location was captured, e.g.
  /// "Yenagoa, Bayelsa - NG" to match the Figma copy's format.
  String get displayLocation {
    final parts = [city, stateRegion, _iso3Suffix()].where((p) => p != null && p.isNotEmpty);
    return parts.isEmpty ? 'Location not set' : parts.join(', ');
  }

  String? _iso3Suffix() => country;
}
