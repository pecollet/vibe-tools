# vibe-tools
A repository of small tools built using genAI

## Tool Catalog

- [plot_csv_metrics](https://pecollet.github.io/vibe-tools/plot_csv_metrics)
- [rolling_distribution](https://pecollet.github.io/vibe-tools/rolling_distribution)
- [config_viewer](https://pecollet.github.io/vibe-tools/config_viewer)
- [query_log_timeline](https://pecollet.github.io/vibe-tools/query_log_timeline)
- [query_log_swimlanes](https://pecollet.github.io/vibe-tools/query_log_swimlanes)
- [aura_hc_shortcuts](https://pecollet.github.io/vibe-tools/aura_hc_shortcuts)
- [hc_most_costly_2_desktop](https://pecollet.github.io/vibe-tools/hc_most_costly_2_desktop)

## Descriptions

### [plot_csv_metrics](https://pecollet.github.io/vibe-tools/plot_csv_metrics)
Visualize any number of metrics from CSV files by dropping the files on the page. 
- multiple metrics can be displayed on the same chart or on multiple charts
- supports dropping zipped CSV files (rotated metrics)
<img width="1007" height="943" alt="image" src="https://github.com/user-attachments/assets/e12a2499-4dd8-440f-b666-922d9b8b6e8e" />

### [rolling_distribution](https://pecollet.github.io/vibe-tools/rolling_distribution)
Create animated rolling distribution histograms from time-series CSV data. 
- Drop a CSV/TSV file with timestamp and numerical columns,
- select the numerical column whose distribution is going to be displayed
- configure the rolling window size and histogram bin count,
- optionally filter the data and choose a grouping column
- then animate the histogram as the rolling window moves over time. Features play/pause controls and a time slider for navigation.


https://github.com/user-attachments/assets/655ae0bd-95de-4830-89ac-817ad2f2f791





### [config_viewer](https://pecollet.github.io/vibe-tools/config_viewer)
Drop a config file and view the config settings in a searchable/sortable table, without the clutter of comments.
<img width="1048" height="932" alt="image" src="https://github.com/user-attachments/assets/fc80dd08-d1f9-45bf-99d2-b44aecefa31a" />

### [query_log_timeline](https://pecollet.github.io/vibe-tools/query_log_timeline)
View query counts on a timeline
<img width="926" height="840" alt="image" src="https://github.com/user-attachments/assets/f38e6c6f-ecdd-4cdf-abdd-8beecd020b04" />

### [query_log_swimlanes](https://pecollet.github.io/vibe-tools/query_log_swimlanes)
View Cypher query executions in a swimlane chart
<img width="1584" height="691" alt="image" src="https://github.com/user-attachments/assets/ae0be8f0-24f7-4a20-b190-98b05919fb5d" />

### [aura_hc_shortcuts](https://pecollet.github.io/vibe-tools/aura_hc_shortcuts)
Common shortcuts to help go through the steps requied to perform an Aura Health Check :
- go to the Preset db lookup dashboard to find your dbid
- go to the SRE portal to generate admin reports
- go to the GCP bucket to retrieve them
- find the CPP id
- go to the Health Check s3 bucket (or the FTP) to upload the admin reports and trigger the Health Check
- open the slack channel to retrieve your Health Check report
<img width="1916" height="590" alt="image" src="https://github.com/user-attachments/assets/bc9b146e-4bf6-46d4-b118-c62525cd0030" />


### [hc_most_costly_2_desktop](https://pecollet.github.io/vibe-tools/hc_most_costly_2_desktop)
Get the list of most costly queries from a Health Check report into Neo4j Browser's (or Aura Console Query's) Saved Cypher section.
Drop the report zip file, click the Export button and import the generated CSV file into your Saved Cypher with <img width="220" height="20" alt="image" src="https://github.com/user-attachments/assets/e9c0c9ad-e7e8-463c-9771-52f46526b362" />

**New Feature**: Generate synthetic Cypher queries with realistic fake data using Faker.js library. 
Configure node/relationship counts & properties with templates including:
- Realistic names, addresses, emails, phone numbers
- Company names and catchphrases  
- Internet URLs and IP addresses
- Financial account numbers
- Lorem ipsum text
- Geographic coordinates and datetime ranges

<img width="994" height="799" alt="image" src="https://github.com/user-attachments/assets/f01d59c3-868e-4520-85ba-94ebebc04347" />
<img width="1294" height="484" alt="image" src="https://github.com/user-attachments/assets/2e5fb8f9-8c6c-4e69-9a35-55e9d335f5d2" />



