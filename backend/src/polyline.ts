/** Decode Google Encoded Polyline (precision 5, as used by Strava). */
export function decodePolyline(encoded: string, precision = 5): Array<[number, number]> {
  if (!encoded) return []
  const coordinates: Array<[number, number]> = []
  let index = 0
  let lat = 0
  let lng = 0
  const factor = 10 ** precision

  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte: number
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1

    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1

    coordinates.push([lat / factor, lng / factor])
  }

  return coordinates
}

export function recordsFromPolyline(
  encoded: string | undefined,
  durationSeconds: number,
): Array<{ elapsedSeconds: number; latitude: number; longitude: number }> {
  if (!encoded) return []
  const points = decodePolyline(encoded)
  if (points.length < 2) return []

  const duration = Math.max(0, durationSeconds)
  const last = points.length - 1
  return points.map(([latitude, longitude], index) => ({
    elapsedSeconds: last === 0 ? 0 : Math.round((duration * index) / last),
    latitude,
    longitude,
  }))
}
