import { fetchGisLayers, getReportsMaster } from "../../lib/ipc"
import type { ClientMaster, LocationFormData, MeterFormData, MeterItem, SupplyFormData, SupplyItem } from "./suppliesTypes"

export const INITIAL_CLIENTS: ClientMaster[] = [
  {
    id: "CLI-001",
    name: "UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS",
    document: "RUC 20148432291",
    address: "Av. Carlos Germán Amezaga 375",
    district: "LIMA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100001",
        code: "100001",
        clientId: "CLI-001",
        clientName: "UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS",
        address: "Av. Carlos Germán Amezaga 375 - Ciudad Universitaria",
        district: "LIMA",
        status: "activo",
        lat: -12.0561,
        lng: -77.0847,
        meterCode: "MED-98231",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2022-03-15",
      },
      {
        id: "SUP-100002",
        code: "100002",
        clientId: "CLI-001",
        clientName: "UNIVERSIDAD NACIONAL MAYOR DE SAN MARCOS",
        address: "Av. Venezuela s/n Puerta 3",
        district: "LIMA",
        status: "activo",
        lat: -12.0583,
        lng: -77.0812,
        meterCode: "MED-98232",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2021-08-20",
      },
    ],
  },
  {
    id: "CLI-002",
    name: "HOSPITAL NACIONAL EDGARDO REBAGLIATI MARTINS",
    document: "RUC 20131257750",
    address: "Av. Edgardo Rebagliati 490",
    district: "JESUS MARIA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100003",
        code: "100003",
        clientId: "CLI-002",
        clientName: "HOSPITAL NACIONAL EDGARDO REBAGLIATI MARTINS",
        address: "Av. Edgardo Rebagliati 490 - Emergencia",
        district: "JESUS MARIA",
        status: "activo",
        lat: -12.0768,
        lng: -77.0425,
        meterCode: "MED-77120",
        meterDiameter: "80",
        meterStatus: "instalado",
        installationDate: "2020-01-10",
      },
      {
        id: "SUP-100004",
        code: "100004",
        clientId: "CLI-002",
        clientName: "HOSPITAL NACIONAL EDGARDO REBAGLIATI MARTINS",
        address: "Jr. Salaverry 1250 - Torre Consultorios",
        district: "JESUS MARIA",
        status: "activo",
        lat: -12.0775,
        lng: -77.0438,
        meterCode: "MED-77121",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2023-05-12",
      },
    ],
  },
  {
    id: "CLI-003",
    name: "MUNICIPALIDAD DE MIRAFLORES",
    document: "RUC 20131376848",
    address: "Av. José Larco 400",
    district: "MIRAFLORES",
    status: "activo",
    supplies: [
      {
        id: "SUP-100005",
        code: "100005",
        clientId: "CLI-003",
        clientName: "MUNICIPALIDAD DE MIRAFLORES",
        address: "Parque Central de Miraflores s/n",
        district: "MIRAFLORES",
        status: "activo",
        lat: -12.1217,
        lng: -77.0305,
        meterCode: "MED-44512",
        meterDiameter: "25",
        meterStatus: "instalado",
        installationDate: "2019-11-05",
      },
      {
        id: "SUP-100006",
        code: "100006",
        clientId: "CLI-003",
        clientName: "MUNICIPALIDAD DE MIRAFLORES",
        address: "Av. Malecón de la Reserva 610",
        district: "MIRAFLORES",
        status: "suspendido",
        lat: -12.1311,
        lng: -77.0318,
        meterCode: "MED-44513",
        meterDiameter: "20",
        meterStatus: "mantenimiento",
        installationDate: "2024-02-18",
      },
    ],
  },
  {
    id: "CLI-004",
    name: "BANCO DE LA NACION",
    document: "RUC 20100030595",
    address: "Av. Javier Prado Este 2499",
    district: "SAN BORJA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100007",
        code: "100007",
        clientId: "CLI-004",
        clientName: "BANCO DE LA NACION",
        address: "Av. Javier Prado Este 2499 - Sede Principal",
        district: "SAN BORJA",
        status: "activo",
        lat: -12.0865,
        lng: -77.0012,
        meterCode: "MED-33201",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2022-09-01",
      },
    ],
  },
  {
    id: "CLI-005",
    name: "COMPLEJO COMERCIAL LA VICTORIA S.A.C.",
    document: "RUC 20551982103",
    address: "Av. Gamarra 820",
    district: "LA VICTORIA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100008",
        code: "100008",
        clientId: "CLI-005",
        clientName: "COMPLEJO COMERCIAL LA VICTORIA S.A.C.",
        address: "Jr. Huanuco 1520 Galerías",
        district: "LA VICTORIA",
        status: "cortado",
        lat: -12.0652,
        lng: -77.0145,
        meterCode: "MED-11098",
        meterDiameter: "15",
        meterStatus: "retirado",
        installationDate: "2018-04-10",
      },
    ],
  },
  {
    id: "CLI-006",
    name: "REAL PLAZA SURCO S.A.",
    document: "RUC 20512874019",
    address: "Av. Caminos del Inca 148",
    district: "SANTIAGO DE SURCO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100009",
        code: "100009",
        clientId: "CLI-006",
        clientName: "REAL PLAZA SURCO S.A.",
        address: "Av. Caminos del Inca 148 - Centro Comercial",
        district: "SANTIAGO DE SURCO",
        status: "activo",
        lat: -12.1154,
        lng: -76.9856,
        meterCode: "MED-55420",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2021-12-01",
      },
    ],
  },
  {
    id: "CLI-007",
    name: "MINISTERIO DE EDUCACION - MINEDU",
    document: "RUC 20131370998",
    address: "Calle Del Comercio 193",
    district: "SAN BORJA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100010",
        code: "100010",
        clientId: "CLI-007",
        clientName: "MINISTERIO DE EDUCACION - MINEDU",
        address: "Calle Del Comercio 193 - Sede Central",
        district: "SAN BORJA",
        status: "activo",
        lat: -12.0878,
        lng: -77.0003,
        meterCode: "MED-88102",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2020-06-14",
      },
    ],
  },
  {
    id: "CLI-008",
    name: "JOCKEY PLAZA SHOPPING CENTER S.A.",
    document: "RUC 20338306076",
    address: "Av. Javier Prado Este 4200",
    district: "SANTIAGO DE SURCO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100011",
        code: "100011",
        clientId: "CLI-008",
        clientName: "JOCKEY PLAZA SHOPPING CENTER S.A.",
        address: "Av. Javier Prado Este 4200 - Patio de Comidas",
        district: "SANTIAGO DE SURCO",
        status: "activo",
        lat: -12.0861,
        lng: -76.9742,
        meterCode: "MED-66231",
        meterDiameter: "80",
        meterStatus: "instalado",
        installationDate: "2019-03-22",
      },
      {
        id: "SUP-100012",
        code: "100012",
        clientId: "CLI-008",
        clientName: "JOCKEY PLAZA SHOPPING CENTER S.A.",
        address: "Av. Manuel Olguín 220",
        district: "SANTIAGO DE SURCO",
        status: "activo",
        lat: -12.0882,
        lng: -76.9731,
        meterCode: "MED-66232",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2021-11-10",
      },
    ],
  },
  {
    id: "CLI-009",
    name: "UNIVERSIDAD DE LIMA",
    document: "RUC 20117079632",
    address: "Av. Javier Prado Este 4600",
    district: "SANTIAGO DE SURCO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100013",
        code: "100013",
        clientId: "CLI-009",
        clientName: "UNIVERSIDAD DE LIMA",
        address: "Av. Javier Prado Este 4600 - Campus",
        district: "SANTIAGO DE SURCO",
        status: "activo",
        lat: -12.0853,
        lng: -76.9701,
        meterCode: "MED-33411",
        meterDiameter: "65",
        meterStatus: "instalado",
        installationDate: "2022-01-18",
      },
    ],
  },
  {
    id: "CLI-010",
    name: "SUPERMERCADOS PERUANOS S.A. - PLAZA VEA SAN ISIDRO",
    document: "RUC 20267790800",
    address: "Av. Las Begonias 750",
    district: "SAN ISIDRO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100014",
        code: "100014",
        clientId: "CLI-010",
        clientName: "SUPERMERCADOS PERUANOS S.A. - PLAZA VEA SAN ISIDRO",
        address: "Av. Las Begonias 750",
        district: "SAN ISIDRO",
        status: "activo",
        lat: -12.0945,
        lng: -77.0312,
        meterCode: "MED-22019",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2020-08-30",
      },
    ],
  },
  {
    id: "CLI-011",
    name: "CLINICA ANGLO AMERICANA S.A.",
    document: "RUC 20100052301",
    address: "Calle Alfredo Salazar 350",
    district: "SAN ISIDRO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100015",
        code: "100015",
        clientId: "CLI-011",
        clientName: "CLINICA ANGLO AMERICANA S.A.",
        address: "Calle Alfredo Salazar 350 - Pabellón A",
        district: "SAN ISIDRO",
        status: "activo",
        lat: -12.1032,
        lng: -77.0381,
        meterCode: "MED-11982",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2023-04-05",
      },
    ],
  },
  {
    id: "CLI-012",
    name: "PONTIFICIA UNIVERSIDAD CATOLICA DEL PERU",
    document: "RUC 20155945860",
    address: "Av. Universitaria 1801",
    district: "SAN MIGUEL",
    status: "activo",
    supplies: [
      {
        id: "SUP-100016",
        code: "100016",
        clientId: "CLI-012",
        clientName: "PONTIFICIA UNIVERSIDAD CATOLICA DEL PERU",
        address: "Av. Universitaria 1801 - Campus San Miguel",
        district: "SAN MIGUEL",
        status: "activo",
        lat: -12.0691,
        lng: -77.0784,
        meterCode: "MED-99410",
        meterDiameter: "80",
        meterStatus: "instalado",
        installationDate: "2019-07-25",
      },
    ],
  },
  {
    id: "CLI-013",
    name: "MUNICIPALIDAD DE SAN ISIDRO",
    document: "RUC 20131378387",
    address: "Calle Augusto Tamayo 180",
    district: "SAN ISIDRO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100017",
        code: "100017",
        clientId: "CLI-013",
        clientName: "MUNICIPALIDAD DE SAN ISIDRO",
        address: "Bosque El Olivar s/n",
        district: "SAN ISIDRO",
        status: "activo",
        lat: -12.0988,
        lng: -77.0362,
        meterCode: "MED-55102",
        meterDiameter: "25",
        meterStatus: "instalado",
        installationDate: "2021-04-12",
      },
    ],
  },
  {
    id: "CLI-014",
    name: "CEMENTOS LIMA S.A.A. - UNACEM",
    document: "RUC 20100138281",
    address: "Atocongo s/n",
    district: "VILLA MARIA DEL TRIUNFO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100018",
        code: "100018",
        clientId: "CLI-014",
        clientName: "CEMENTOS LIMA S.A.A. - UNACEM",
        address: "Planta Atocongo s/n",
        district: "VILLA MARIA DEL TRIUNFO",
        status: "activo",
        lat: -12.1645,
        lng: -76.9412,
        meterCode: "MED-90012",
        meterDiameter: "100",
        meterStatus: "instalado",
        installationDate: "2018-09-01",
      },
    ],
  },
  {
    id: "CLI-015",
    name: "INSTITUTO NACIONAL DE SALUD DEL NINO",
    document: "RUC 20152912499",
    address: "Av. Brasil 600",
    district: "BREÑA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100019",
        code: "100019",
        clientId: "CLI-015",
        clientName: "INSTITUTO NACIONAL DE SALUD DEL NINO",
        address: "Av. Brasil 600",
        district: "BREÑA",
        status: "activo",
        lat: -12.0628,
        lng: -77.0456,
        meterCode: "MED-44120",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2020-03-10",
      },
    ],
  },
  {
    id: "CLI-016",
    name: "EMPRESA DE TRANSPORTES BUSES PERU S.A.",
    document: "RUC 20601248912",
    address: "Av. Morales Duárez 2100",
    district: "CALLAO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100020",
        code: "100020",
        clientId: "CLI-016",
        clientName: "EMPRESA DE TRANSPORTES BUSES PERU S.A.",
        address: "Av. Morales Duárez 2100 Terminal",
        district: "CALLAO",
        status: "activo",
        lat: -12.0312,
        lng: -77.1082,
        meterCode: "MED-31290",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2022-07-19",
      },
    ],
  },
  {
    id: "CLI-017",
    name: "UNIVERSIDAD NACIONAL DE INGENIERIA - UNI",
    document: "RUC 20149090172",
    address: "Av. Túpac Amaru 210",
    district: "RIMAC",
    status: "activo",
    supplies: [
      {
        id: "SUP-100021",
        code: "100021",
        clientId: "CLI-017",
        clientName: "UNIVERSIDAD NACIONAL DE INGENIERIA - UNI",
        address: "Av. Túpac Amaru 210 - Pabellón Central",
        district: "RIMAC",
        status: "activo",
        lat: -12.0162,
        lng: -77.0491,
        meterCode: "MED-77401",
        meterDiameter: "65",
        meterStatus: "instalado",
        installationDate: "2021-02-15",
      },
    ],
  },
  {
    id: "CLI-018",
    name: "MUNICIPALIDAD METROPOLITANA DE LIMA",
    document: "RUC 20131380951",
    address: "Jr. de la Unión 300",
    district: "LIMA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100022",
        code: "100022",
        clientId: "CLI-018",
        clientName: "MUNICIPALIDAD METROPOLITANA DE LIMA",
        address: "Plaza Mayor de Lima s/n",
        district: "LIMA",
        status: "activo",
        lat: -12.0453,
        lng: -77.0304,
        meterCode: "MED-10293",
        meterDiameter: "32",
        meterStatus: "instalado",
        installationDate: "2019-10-01",
      },
    ],
  },
  {
    id: "CLI-019",
    name: "MINISTERIO DE SALUD - MINSA",
    document: "RUC 20131373237",
    address: "Av. Salaverry 801",
    district: "JESUS MARIA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100023",
        code: "100023",
        clientId: "CLI-019",
        clientName: "MINISTERIO DE SALUD - MINSA",
        address: "Av. Salaverry 801",
        district: "JESUS MARIA",
        status: "activo",
        lat: -12.0721,
        lng: -77.0401,
        meterCode: "MED-91023",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2020-11-20",
      },
    ],
  },
  {
    id: "CLI-020",
    name: "PETROPERU S.A.",
    document: "RUC 20100128218",
    address: "Av. Enrique Canaval y Moreyra 150",
    district: "SAN ISIDRO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100024",
        code: "100024",
        clientId: "CLI-020",
        clientName: "PETROPERU S.A.",
        address: "Av. Enrique Canaval y Moreyra 150 - Edificio Central",
        district: "SAN ISIDRO",
        status: "activo",
        lat: -12.0965,
        lng: -77.0289,
        meterCode: "MED-88912",
        meterDiameter: "65",
        meterStatus: "instalado",
        installationDate: "2019-05-14",
      },
    ],
  },
  {
    id: "CLI-021",
    name: "MUNICIPALIDAD DE ATE",
    document: "RUC 20131373741",
    address: "Av. Central 101",
    district: "ATE",
    status: "activo",
    supplies: [
      {
        id: "SUP-100025",
        code: "100025",
        clientId: "CLI-021",
        clientName: "MUNICIPALIDAD DE ATE",
        address: "Av. Nicolás de Piérola s/n Huaycán",
        district: "ATE",
        status: "activo",
        lat: -12.0281,
        lng: -76.9210,
        meterCode: "MED-55019",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2021-08-01",
      },
    ],
  },
  {
    id: "CLI-022",
    name: "UNIVERSIDAD SAN IGNACIO DE LOYOLA - USIL",
    document: "RUC 20297864356",
    address: "Av. La Fontana 550",
    district: "LA MOLINA",
    status: "activo",
    supplies: [
      {
        id: "SUP-100026",
        code: "100026",
        clientId: "CLI-022",
        clientName: "UNIVERSIDAD SAN IGNACIO DE LOYOLA - USIL",
        address: "Av. La Fontana 550 - Campus Fernando Belaunde",
        district: "LA MOLINA",
        status: "activo",
        lat: -12.0745,
        lng: -76.9532,
        meterCode: "MED-77182",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2022-04-10",
      },
    ],
  },
  {
    id: "CLI-023",
    name: "SODIMAC PERU S.A. - SAN MIGUEL",
    document: "RUC 20504892404",
    address: "Av. la Marina 2500",
    district: "SAN MIGUEL",
    status: "activo",
    supplies: [
      {
        id: "SUP-100027",
        code: "100027",
        clientId: "CLI-023",
        clientName: "SODIMAC PERU S.A. - SAN MIGUEL",
        address: "Av. la Marina 2500",
        district: "SAN MIGUEL",
        status: "activo",
        lat: -12.0772,
        lng: -77.0912,
        meterCode: "MED-33901",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2020-09-18",
      },
    ],
  },
  {
    id: "CLI-024",
    name: "UNIVERSIDAD PERUANA CAYETANO HEREDIA - UPCH",
    document: "RUC 20111451599",
    address: "Av. Honorio Delgado 430",
    district: "SAN MARTIN DE PORRES",
    status: "activo",
    supplies: [
      {
        id: "SUP-100028",
        code: "100028",
        clientId: "CLI-024",
        clientName: "UNIVERSIDAD PERUANA CAYETANO HEREDIA - UPCH",
        address: "Av. Honorio Delgado 430 - Campus Central",
        district: "SAN MARTIN DE PORRES",
        status: "activo",
        lat: -12.0251,
        lng: -77.0562,
        meterCode: "MED-66109",
        meterDiameter: "65",
        meterStatus: "instalado",
        installationDate: "2019-12-05",
      },
    ],
  },
  {
    id: "CLI-025",
    name: "MUNICIPALIDAD PROVINCIAL DEL CALLAO",
    document: "RUC 20131375957",
    address: "Jr. Paz Soldán 252",
    district: "CALLAO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100029",
        code: "100029",
        clientId: "CLI-025",
        clientName: "MUNICIPALIDAD PROVINCIAL DEL CALLAO",
        address: "Plaza Casanave s/n",
        district: "CALLAO",
        status: "activo",
        lat: -12.0610,
        lng: -77.1481,
        meterCode: "MED-11902",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2021-06-30",
      },
    ],
  },
  {
    id: "CLI-026",
    name: "MUNICIPALIDAD DE CHACLACAYO",
    document: "RUC 20131375108",
    address: "Av. Nicolás de Piérola 114",
    district: "CHACLACAYO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100030",
        code: "100030",
        clientId: "CLI-026",
        clientName: "MUNICIPALIDAD DE CHACLACAYO",
        address: "Av. Nicolás de Piérola 114 - Sede Municipal",
        district: "CHACLACAYO",
        status: "activo",
        lat: -11.9792,
        lng: -76.7681,
        meterCode: "MED-55912",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2021-09-15",
      },
      {
        id: "SUP-100031",
        code: "100031",
        clientId: "CLI-026",
        clientName: "MUNICIPALIDAD DE CHACLACAYO",
        address: "Parque Central de Chaclacayo s/n",
        district: "CHACLACAYO",
        status: "activo",
        lat: -11.9801,
        lng: -76.7695,
        meterCode: "MED-55913",
        meterDiameter: "25",
        meterStatus: "instalado",
        installationDate: "2023-02-20",
      },
    ],
  },
  {
    id: "CLI-027",
    name: "MUNICIPALIDAD DE SAN JUAN DE LURIGANCHO",
    document: "RUC 20131377810",
    address: "Av. Próceres de la Independencia 1636",
    district: "SAN JUAN DE LURIGANCHO",
    status: "activo",
    supplies: [
      {
        id: "SUP-100032",
        code: "100032",
        clientId: "CLI-027",
        clientName: "MUNICIPALIDAD DE SAN JUAN DE LURIGANCHO",
        address: "Av. Próceres de la Independencia 1636 - Palacio Municipal",
        district: "SAN JUAN DE LURIGANCHO",
        status: "activo",
        lat: -11.9875,
        lng: -76.9982,
        meterCode: "MED-88129",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2020-04-18",
      },
    ],
  },
  {
    id: "CLI-028",
    name: "MUNICIPALIDAD DE COMAS",
    document: "RUC 20131374551",
    address: "Av. 22 de Agosto s/n Plaza de Armas",
    district: "COMAS",
    status: "activo",
    supplies: [
      {
        id: "SUP-100033",
        code: "100033",
        clientId: "CLI-028",
        clientName: "MUNICIPALIDAD DE COMAS",
        address: "Av. 22 de Agosto s/n Plaza de Armas de Comas",
        district: "COMAS",
        status: "activo",
        lat: -11.9381,
        lng: -77.0512,
        meterCode: "MED-44810",
        meterDiameter: "40",
        meterStatus: "instalado",
        installationDate: "2022-10-05",
      },
    ],
  },
  {
    id: "CLI-029",
    name: "MUNICIPALIDAD DE LOS OLIVOS",
    document: "RUC 20131377143",
    address: "Av. Carlos Izaguirre 807",
    district: "LOS OLIVOS",
    status: "activo",
    supplies: [
      {
        id: "SUP-100034",
        code: "100034",
        clientId: "CLI-029",
        clientName: "MUNICIPALIDAD DE LOS OLIVOS",
        address: "Av. Carlos Izaguirre 807 - Palacio Municipal",
        district: "LOS OLIVOS",
        status: "activo",
        lat: -11.9912,
        lng: -77.0718,
        meterCode: "MED-33912",
        meterDiameter: "50",
        meterStatus: "instalado",
        installationDate: "2021-03-22",
      },
    ],
  },
  {
    id: "CLI-030",
    name: "MUNICIPALIDAD DE CHORRILLOS",
    document: "RUC 20131374217",
    address: "Av. Defensores del Morro 550",
    district: "CHORRILLOS",
    status: "activo",
    supplies: [
      {
        id: "SUP-100035",
        code: "100035",
        clientId: "CLI-030",
        clientName: "MUNICIPALIDAD DE CHORRILLOS",
        address: "Av. Defensores del Morro 550 - Malecón Grau",
        district: "CHORRILLOS",
        status: "activo",
        lat: -12.1721,
        lng: -77.0289,
        meterCode: "MED-77102",
        meterDiameter: "32",
        meterStatus: "instalado",
        installationDate: "2019-08-11",
      },
    ],
  },
]

let clientsStore: ClientMaster[] = [...INITIAL_CLIENTS]
let isBackendLoaded = false

export function getClientsStore(): ClientMaster[] {
  return clientsStore
}

export async function loadClientsFromBackend(): Promise<ClientMaster[]> {
  if (isBackendLoaded) return clientsStore

  try {
    const groupedMap = new Map<string, ClientMaster>()

    // First add initial clients
    for (const client of clientsStore) {
      groupedMap.set(client.name.toUpperCase(), { ...client, supplies: [...client.supplies] })
    }

    // Attempt 1: Fetch real supply vector layer features across all of Lima & Callao
    try {
      const gisData = await fetchGisLayers({
        bbox: [-77.35, -12.35, -76.65, -11.65],
        layers: ["suministros"],
        page: 1,
        pageSize: 1500,
        zoom: 16,
      })

      const features = gisData?.layers?.suministros?.data?.features
      if (Array.isArray(features) && features.length > 0) {
        for (const feat of features) {
          const props = feat.properties || {}
          const supplyCode = String(props.supply_code || props.code || "").trim()
          if (!supplyCode) continue

          const clientName = String(props.customer_name || `CLIENTE SUMINISTRO ${supplyCode}`).trim().toUpperCase()
          const district = String(props.district || "LIMA").trim().toUpperCase()
          const address = String(props.service_address || `${district} Suministro ${supplyCode}`).trim()
          const status = String(props.supply_status || "activo").toLowerCase() as "activo" | "suspendido" | "cortado"
          const meterCode = String(props.meter_code || `MED-${supplyCode}`).trim()
          const meterDiameter = String(props.meter_diameter || "20").trim()
          const installationDate = String(props.installation_date || "2023-01-01").trim()

          const coords = feat.geometry?.type === "Point" && Array.isArray(feat.geometry.coordinates)
            ? [feat.geometry.coordinates[1], feat.geometry.coordinates[0]] as [number, number]
            : [-12.04637, -77.04279] as [number, number]

          let client = groupedMap.get(clientName)
          if (!client) {
            client = {
              id: `CLI-${groupedMap.size + 100}`,
              name: clientName,
              document: `RUC 20${Math.floor(100000000 + Math.random() * 900000000)}`,
              address: address,
              district: district,
              status: "activo",
              supplies: [],
            }
            groupedMap.set(clientName, client)
          }

          if (!client.supplies.some((s) => s.code === supplyCode)) {
            client.supplies.push({
              id: `SUP-${supplyCode}`,
              code: supplyCode,
              clientId: client.id,
              clientName: client.name,
              address: address,
              district: district,
              status: status,
              lat: coords[0],
              lng: coords[1],
              meterCode: meterCode,
              meterDiameter: meterDiameter,
              meterStatus: "instalado",
              installationDate: installationDate,
            })
          }
        }
      }
    } catch (_e) {
      // Ignore if spatial fetch fails
    }

    // Attempt 2: Fetch report master rows
    try {
      const reportsPage = await getReportsMaster({
        page: 1,
        pageSize: 1500,
        search: "",
        filterActive: false,
        trendDirection: "either",
        minTrendPercent: 0,
        baselineStartPeriod: "2024-01",
        baselineEndPeriod: "2024-12",
        targetStartPeriod: "2025-01",
        targetEndPeriod: "2025-12",
      })

      if (reportsPage && Array.isArray(reportsPage.data) && reportsPage.data.length > 0) {
        for (const row of reportsPage.data) {
          const clientName = (row.customerName || `CLIENTE SUMINISTRO ${row.supplyCode}`).toUpperCase()
          const district = row.district || "LIMA"
          let client = groupedMap.get(clientName)

          if (!client) {
            client = {
              id: `CLI-${groupedMap.size + 100}`,
              name: clientName,
              document: `RUC 20${Math.floor(100000000 + Math.random() * 900000000)}`,
              address: `${district} - Sede Comercial`,
              district: district,
              status: "activo",
              supplies: [],
            }
            groupedMap.set(clientName, client)
          }

          if (!client.supplies.some((s) => s.code === row.supplyCode)) {
            client.supplies.push({
              id: `SUP-${row.supplyCode}`,
              code: row.supplyCode,
              clientId: client.id,
              clientName: client.name,
              address: `${district} - Suministro ${row.supplyCode}`,
              district: district,
              status: "activo",
              lat: -12.04637 + (Math.random() - 0.5) * 0.1,
              lng: -77.04279 + (Math.random() - 0.5) * 0.1,
              meterCode: row.meterSerial || `MED-${row.supplyCode}`,
              meterDiameter: "20",
              meterStatus: "instalado",
              installationDate: "2023-01-01",
            })
          }
        }
      }
    } catch (_e) {
      // Ignore if reports master fetch fails
    }

    clientsStore = Array.from(groupedMap.values())
    isBackendLoaded = true
  } catch (_e) {
    // If backend IPC unavailable, clientsStore has full 25+ initial clients
  }

  return clientsStore
}

export function getAllMeters(): MeterItem[] {
  const meters: MeterItem[] = []
  for (const client of clientsStore) {
    for (const sup of client.supplies) {
      if (sup.meterCode) {
        meters.push({
          id: `MTR-${sup.meterCode}`,
          code: sup.meterCode,
          diameter: sup.meterDiameter,
          status: sup.meterStatus,
          installationDate: sup.installationDate,
          supplyCode: sup.code,
          clientName: client.name,
        })
      }
    }
  }
  return meters
}

export function updateSupplyInStore(updatedSupply: SupplyFormData): void {
  clientsStore = clientsStore.map((client) => {
    const updatedSupplies = client.supplies.map((sup) => {
      if (sup.code === updatedSupply.code || sup.id === updatedSupply.code) {
        return {
          ...sup,
          address: updatedSupply.address,
          district: updatedSupply.district,
          status: updatedSupply.status,
          lat: updatedSupply.lat,
          lng: updatedSupply.lng,
          meterCode: updatedSupply.meterCode,
          meterDiameter: updatedSupply.meterDiameter,
          meterStatus: updatedSupply.meterStatus,
          installationDate: updatedSupply.installationDate,
        }
      }
      return sup
    })
    return { ...client, supplies: updatedSupplies }
  })
}

export function updateSupplyLocationInStore(locationData: LocationFormData): void {
  clientsStore = clientsStore.map((client) => {
    const updatedSupplies = client.supplies.map((sup) => {
      if (sup.code === locationData.supplyCode) {
        return {
          ...sup,
          address: locationData.address || sup.address,
          district: locationData.district || sup.district,
          lat: locationData.lat,
          lng: locationData.lng,
        }
      }
      return sup
    })
    return { ...client, supplies: updatedSupplies }
  })
}

export function addSupplyToStore(data: SupplyFormData): void {
  let targetClient = clientsStore.find((c) => c.id === data.clientId || c.name === data.clientId)
  
  if (!targetClient) {
    targetClient = {
      id: `CLI-${Date.now().toString().slice(-4)}`,
      name: data.clientName || data.clientId || "NUEVO CLIENTE",
      document: "RUC 20999888771",
      address: data.address,
      district: data.district,
      status: "activo",
      supplies: [],
    }
    clientsStore.push(targetClient)
  }

  const newSupply: SupplyItem = {
    id: `SUP-${data.code}`,
    code: data.code,
    clientId: targetClient.id,
    clientName: targetClient.name,
    address: data.address,
    district: data.district,
    status: data.status,
    lat: data.lat,
    lng: data.lng,
    meterCode: data.meterCode,
    meterDiameter: data.meterDiameter,
    meterStatus: data.meterStatus,
    installationDate: data.installationDate,
  }

  targetClient.supplies.push(newSupply)
}

export function addMeterToStore(data: MeterFormData): void {
  clientsStore = clientsStore.map((client) => {
    const updatedSupplies = client.supplies.map((sup) => {
      if (sup.code === data.supplyCode) {
        return {
          ...sup,
          meterCode: data.code,
          meterDiameter: data.diameter,
          meterStatus: data.status,
          installationDate: data.installationDate,
        }
      }
      return sup
    })
    return { ...client, supplies: updatedSupplies }
  })
}
